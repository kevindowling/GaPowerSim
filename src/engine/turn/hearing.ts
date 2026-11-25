export interface HearingOption {
  id: string
  label: string
  detail: string
  /** Dollars the player absorbs. */
  cost: number
  /** Approval change in the scenario county. */
  approvalDelta: number
  /** Shown in the county record and on the scorecard. */
  grievance: string | null
  /** How much of the cost goes to ratepayers, 0 to 1. */
  ratepayerShare: number
}

export const UPGRADE_COST = 48_000_000

export const HEARING_OPTIONS: readonly HearingOption[] = [
  {
    id: 'hyperscaler-pays',
    label: 'Pay it all yourself',
    detail: 'You cover the upgrades. Other customers pay nothing.',
    cost: UPGRADE_COST,
    approvalDelta: 14,
    grievance: null,
    ratepayerShare: 0,
  },
  {
    id: 'split',
    label: 'Split it in half',
    detail: 'Half from you, half from every customer in the state.',
    cost: UPGRADE_COST / 2,
    approvalDelta: -4,
    grievance: 'Half the upgrade cost went to the rate base',
    ratepayerShare: 0.5,
  },
  {
    id: 'ratepayers-pay',
    label: 'Charge it to the rate base',
    detail: 'Every household in the state pays a share of a line built for one customer.',
    cost: 0,
    approvalDelta: -22,
    grievance: 'Households paid for a line built for the campus',
    ratepayerShare: 1,
  },
]
