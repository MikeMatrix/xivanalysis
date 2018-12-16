import {i18nMark, Plural, Trans} from '@lingui/react'
import {ActionLink, StatusLink} from 'components/ui/DbLink'
import Rotation from 'components/ui/Rotation'
import ACTIONS from 'data/ACTIONS'
import STATUSES from 'data/STATUSES'
import {CastEvent} from 'fflogs'
import _ from 'lodash'
import Module, {dependency} from 'parser/core/Module'
import Combatants from 'parser/core/modules/Combatants'
import Suggestions, {SEVERITY, TieredSuggestion} from 'parser/core/modules/Suggestions'
import Timeline from 'parser/core/modules/Timeline'
import React from 'react'
import {Button, Table} from 'semantic-ui-react'

interface TimestampRotationMap {
	[timestamp: number]: CastEvent[]
}

const SEVERITIES = {
	MISSED_HOLY_SPIRITS: {
		1: SEVERITY.MEDIUM,
		5: SEVERITY.MAJOR,
	},
	MISSED_BUFF_REQUIESCAT: {
		1: SEVERITY.MAJOR,
	},
}

const CONSTANTS = {
	MP: {
		TICK_AMOUNT: 141,
	},
	REQUIESCAT: {
		MP_THRESHOLD: 0.8,
	},
	HOLY_SPIRIT: {
		EXPECTED: 5,
	},
}

class RequiescatState {
	start: number | null = null
	holySpirits: number = 0
}

class RequiescatErrorResult {
	missedHolySpirits: number = 0
	missedRequiescatBuffs: number = 0
}

export default class Requiescat extends Module {
	static handle = 'requiescat'
	static title = 'Requiescat Usage'
	static i18n_id = i18nMark('pld.requiescat.title') // tslint:disable-line:variable-name

	@dependency private suggestions!: Suggestions
	@dependency private combatants!: Combatants
	@dependency private timeline!: Timeline

	// Internal State Counters
	// ToDo: Merge some of these, so instead of saving rotations, make the rotation part of RequiState, so we can reduce the error result out of the saved rotations
	private requiescatState = new RequiescatState()
	private requiescatRotations: TimestampRotationMap = {}
	private requiescatErrorResult = new RequiescatErrorResult()

	protected init() {
		this.addHook('cast', {by: 'player'}, this.onCast)
		this.addHook(
			'removebuff',
			{by: 'player', abilityId: STATUSES.REQUIESCAT.id},
			this.onRemoveRequiescat,
		)
		this.addHook('complete', this.onComplete)
	}

	private onCast(event: CastEvent) {
		const actionId = event.ability.guid

		if (actionId === ACTIONS.ATTACK.id) {
			return
		}

		if (actionId === ACTIONS.REQUIESCAT.id) {
			const {mp, maxMP} = this.combatants.selected.resources

			// We only track buff windows
			// Allow for inaccuracies of 1 MP Tick
			if ((mp + CONSTANTS.MP.TICK_AMOUNT) / maxMP >= CONSTANTS.REQUIESCAT.MP_THRESHOLD) {
				this.requiescatState.start = event.timestamp
			} else {
				this.requiescatErrorResult.missedRequiescatBuffs++
			}
		}

		if (this.requiescatState.start != null) {
			if (actionId === ACTIONS.HOLY_SPIRIT.id) {
				this.requiescatState.holySpirits++
			}

			if (!Array.isArray(this.requiescatRotations[this.requiescatState.start])) {
				this.requiescatRotations[this.requiescatState.start] = []
			}

			this.requiescatRotations[this.requiescatState.start].push(event)
		}
	}

	private onRemoveRequiescat() {
		// Clamp to 0 since we can't miss negative
		this.requiescatErrorResult.missedHolySpirits += Math.max(0, CONSTANTS.HOLY_SPIRIT.EXPECTED - this.requiescatState.holySpirits)
		this.requiescatState = new RequiescatState()
	}

	private onComplete() {
		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.REQUIESCAT.icon,
			why: <Trans id="pld.requiescat.suggestions.wrong-gcd.why">
				<Plural value={this.requiescatErrorResult.missedHolySpirits} one="# wrong GCD" other="# wrong GCDs"/> during the <StatusLink {...STATUSES.REQUIESCAT}/> buff window.
			</Trans>,
			content: <Trans id="pld.requiescat.suggestions.wrong-gcd.content">
				GCDs used during <ActionLink {...ACTIONS.REQUIESCAT}/> should be limited to <ActionLink {...ACTIONS.HOLY_SPIRIT}/> for optimal damage.
			</Trans>,
			tiers: SEVERITIES.MISSED_HOLY_SPIRITS,
			value: this.requiescatErrorResult.missedHolySpirits,
		}))

		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.REQUIESCAT.icon,
			why: <Trans id="pld.requiescat.suggestions.nobuff.why">
				<Plural value={this.requiescatErrorResult.missedRequiescatBuffs} one="# usage" other="# usages"/> while under 80% MP.
			</Trans>,
			content: <Trans id="pld.requiescat.suggestions.nobuff.content">
				<ActionLink {...ACTIONS.REQUIESCAT}/> should only be used when over 80% MP. Try to not miss on the 20% Magic Damage buff <StatusLink {...STATUSES.REQUIESCAT}/> provides.
			</Trans>,
			tiers: SEVERITIES.MISSED_BUFF_REQUIESCAT,
			value: this.requiescatErrorResult.missedRequiescatBuffs,
		}))
	}

	private RotationTableRow = ({timestamp, rotation}: {timestamp: number, rotation: CastEvent[]}) => {
		const holySpiritCount = rotation
			.filter(event => event.ability.guid === ACTIONS.HOLY_SPIRIT.id)
			.length

		return <Table.Row>
			<Table.Cell textAlign="center">
				<span style={{marginRight: 5}}>{this.parser.formatTimestamp(timestamp)}</span>
				<Button
					circular
					compact
					size="mini"
					icon="time"
					onClick={() => this.timeline.show(timestamp - this.parser.fight.start_time, timestamp + (STATUSES.REQUIESCAT.duration * 1000) - this.parser.fight.start_time)}
				/>
			</Table.Cell>
			<Table.Cell textAlign="center" positive={holySpiritCount >= CONSTANTS.HOLY_SPIRIT.EXPECTED} negative={holySpiritCount < CONSTANTS.HOLY_SPIRIT.EXPECTED}>
				{holySpiritCount}/{CONSTANTS.HOLY_SPIRIT.EXPECTED}
			</Table.Cell>
			<Table.Cell>
				<Rotation events={rotation}/>
			</Table.Cell>
		</Table.Row>
	}

	output() {
		return <Table compact unstackable celled>
			<Table.Header>
				<Table.Row>
					<Table.HeaderCell collapsing>
						<strong><Trans id="pld.requiescat.table.header.time">Time</Trans></strong>
					</Table.HeaderCell>
					<Table.HeaderCell textAlign="center" collapsing>
						<strong><ActionLink showName={false} {...ACTIONS.HOLY_SPIRIT}/></strong>
					</Table.HeaderCell>
					<Table.HeaderCell>
						<strong><Trans id="pld.requiescat.table.header.rotation">Rotation</Trans></strong>
					</Table.HeaderCell>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{
					Object.keys(this.requiescatRotations)
						.map(timestamp => {
							const ts = _.toNumber(timestamp)

							return <this.RotationTableRow
								key={timestamp}
								timestamp={ts}
								rotation={this.requiescatRotations[ts]}
							/>
						})
				}
			</Table.Body>
		</Table>
	}
}