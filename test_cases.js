/**
 * Standardized test cases for the rule-based recommendation engine.
 *
 * Each case supplies survey answers + company profile, then asserts on the
 * engine output. Cases cover the maturity spectrum, data-readiness gaps,
 * deployment constraints, budget limits and non-manufacturing exclusion.
 *
 * Option indices refer to the survey option order:
 *   Q13/Q18: 0 R&D, 1 Production, 2 Supply chain, 3 Quality, 4 Equipment,
 *            5 Facility, 6 Carbon/Energy, 7 Customer service,
 *            8 Operations/BI, 9 HR, 10 Logistics
 *   Q19:     0 none, 1 too costly, 2 lack talent, 3 benefits unclear,
 *            4 risks unclear, 5 culture, 6 data-leak concern, 7 data not
 *            integrated, 8 leadership, 9 IT infra, 10 stability,
 *            11 maintenance cost, 12 energy, 13 other
 */
const TEST_CASES = [
  {
    id: 'TC-01',
    name: 'High-maturity manufacturer, vision quality inspection already running',
    rationale: 'Mature data foundation + vision pipeline should surface S04 solutions as recommended.',
    form: { location: 'Greater China', sub_industry: 'C26 Manufacture of Electronic Parts and Components' },
    answers: {
      single: { q2: 4, q3: 4, q4: 3, q5: 4, q14: 3 },
      multiple: { q13: [3], q18: [3], q19: [2] }
    },
    expect: {
      topScenario: 'S04',
      minRecommended: 1,
      requireReasons: true,
      maxScore: 100
    }
  },
  {
    id: 'TC-02',
    name: 'Low-maturity SME, no IIoT, wants quality inspection',
    rationale: 'Should NOT be silently recommended a real-time vision system; must be flagged conditional with a data prerequisite.',
    form: { location: 'ASEAN', sub_industry: 'C22 Manufacture of Plastics Products' },
    answers: {
      single: { q2: 0, q3: 1, q4: 1, q5: 0, q14: 1 },
      multiple: { q13: [], q18: [3], q19: [7, 9] }
    },
    expect: {
      topScenario: 'S04',
      maxRecommended: 2,
      requireConditional: true,
      requirePrerequisiteMentioningIIoT: true
    }
  },
  {
    id: 'TC-03',
    name: 'Predictive maintenance with partial IIoT coverage',
    rationale: 'Equipment-maintenance pain should rank S05; partial IIoT produces an explicit unmet condition, not exclusion.',
    form: { location: 'Europe', sub_industry: 'C24 Manufacture of Basic Metals' },
    answers: {
      single: { q2: 2, q3: 3, q4: 2, q5: 3, q14: 2 },
      multiple: { q13: [4], q18: [4], q19: [11] }
    },
    expect: {
      topScenario: 'S05',
      minRecommended: 1
    }
  },
  {
    id: 'TC-04',
    name: 'Energy and carbon reduction programme',
    rationale: 'Facility + carbon selections must map to S06, never to quality or maintenance.',
    form: { location: 'Japan & Korea', sub_industry: 'C17 Manufacture of Petroleum and Coal Products' },
    answers: {
      single: { q2: 3, q3: 3, q4: 2, q5: 3, q14: 2 },
      multiple: { q13: [5, 6], q18: [6], q19: [12] }
    },
    expect: {
      topScenario: 'S06',
      minRecommended: 1,
      topMustBeIn: ['S06']
    }
  },
  {
    id: 'TC-05',
    name: 'Generative AI for customer service in a low-data organisation',
    rationale: 'S07 should rank, but batch/knowledge-base requirements must surface as conditions.',
    form: { location: 'North America', sub_industry: 'C29 Manufacture of Machinery and Equipment' },
    answers: {
      single: { q2: 1, q3: 1, q4: 2, q5: 2, q14: 1 },
      multiple: { q13: [7], q18: [7], q19: [2, 3] }
    },
    expect: {
      topScenario: 'S07',
      minRecommended: 1
    }
  },
  {
    id: 'TC-06',
    name: 'On-premise data-residency constraint excludes cloud-only vendors',
    rationale: 'A data-leak concern must hard-exclude cloud-only solutions and record the reason.',
    form: { location: 'Europe', sub_industry: 'C21 Manufacture of Rubber Products' },
    answers: {
      single: { q2: 3, q3: 3, q4: 3, q5: 3, q14: 2 },
      multiple: { q13: [3], q18: [3, 5], q19: [6] }
    },
    expect: {
      minExcluded: 1,
      excludedReasonPattern: 'Cloud-only',
      recommendedMustSupportOnPremise: true
    }
  },
  {
    id: 'TC-07',
    name: 'Integration requirement excludes closed systems',
    rationale: 'When data is not integrated and API is required, no-API solutions must be excluded with a reason.',
    form: { location: 'Greater China', sub_industry: 'C27 Manufacture of Computers, Electronic and Optical Products' },
    answers: {
      single: { q2: 3, q3: 2, q4: 2, q5: 3, q14: 3 },
      multiple: { q13: [1], q18: [1, 8], q19: [7] }
    },
    expect: {
      minExcluded: 1,
      excludedReasonPattern: 'no API',
      requireIntegrationReason: true
    }
  },
  {
    id: 'TC-08',
    name: 'Low budget versus high-cost solutions',
    rationale: 'High-cost solutions must be downgraded to conditional with a budget unmet condition.',
    form: { location: 'South Asia', sub_industry: 'C13 Manufacture of Leather and Related Products' },
    answers: {
      single: { q2: 2, q3: 2, q4: 1, q5: 0, q14: 1 },
      multiple: { q13: [1], q18: [1], q19: [1] }
    },
    expect: {
      requireBudgetCondition: true
    }
  },
  {
    id: 'TC-09',
    name: 'Multi-scenario manufacturer (production + quality + maintenance)',
    rationale: 'Multi-scenario needs must produce a diversified recommendation set spanning more than one scenario.',
    form: { location: 'North America', sub_industry: 'C30 Manufacture of Motor Vehicles and Parts' },
    answers: {
      single: { q2: 4, q3: 4, q4: 4, q5: 4, q14: 3 },
      multiple: { q13: [1, 3, 4], q18: [1, 3, 4], q19: [2] }
    },
    expect: {
      minRecommended: 3,
      minDistinctScenariosInTop: 2,
      maxScore: 100
    }
  },
  {
    id: 'TC-10',
    name: 'Non-manufacturing solutions never appear',
    rationale: 'E-commerce, digital business card and firewall tools have no scenario mapping and must be excluded.',
    form: { location: 'Greater China', sub_industry: 'C26 Manufacture of Electronic Parts and Components' },
    answers: {
      single: { q2: 3, q3: 3, q4: 3, q5: 3, q14: 2 },
      multiple: { q13: [8], q18: [8], q19: [3] }
    },
    expect: {
      forbiddenNamePatterns: ['e-commerce', 'business card', 'firewall'],
      minExcluded: 1
    }
  },
  {
    id: 'TC-11',
    name: 'Determinism — identical input yields identical output',
    rationale: 'Rule engines must be reproducible for audit and consultant review.',
    form: { location: 'Europe', sub_industry: 'C25 Manufacture of Fabricated Metal Products' },
    answers: {
      single: { q2: 3, q3: 3, q4: 2, q5: 3, q14: 2 },
      multiple: { q13: [3, 4], q18: [3], q19: [2] }
    },
    expect: { deterministic: true }
  },
  {
    id: 'TC-12',
    name: 'Score integrity — breakdown sums to total, all components within weight caps',
    rationale: 'Transparent scoring must be arithmetically verifiable.',
    form: { location: 'Oceania', sub_industry: 'C28 Manufacture of Electrical Equipment' },
    answers: {
      single: { q2: 3, q3: 3, q4: 2, q5: 3, q14: 2 },
      multiple: { q13: [1, 3], q18: [4], q19: [11] }
    },
    expect: { verifyBreakdown: true }
  },
  {
    id: 'TC-13',
    name: 'Every recommendation carries an explanation',
    rationale: 'A recommendation without a reason is not auditable.',
    form: { location: 'Latin America', sub_industry: 'C10 Manufacture of Beverages' },
    answers: {
      single: { q2: 2, q3: 2, q4: 2, q5: 2, q14: 1 },
      multiple: { q13: [2], q18: [2, 10], q19: [2] }
    },
    expect: { requireReasons: true, minRecommended: 1 }
  },
  {
    id: 'TC-14',
    name: 'Exclusions are explained, never silent',
    rationale: 'Every excluded solution must state the blocking condition.',
    form: { location: 'Middle East', sub_industry: 'C23 Manufacture of Other Non-metallic Mineral Products' },
    answers: {
      single: { q2: 2, q3: 2, q4: 2, q5: 2, q14: 2 },
      multiple: { q13: [3], q18: [3], q19: [6, 7] }
    },
    expect: { excludedAllExplained: true }
  },
  {
    id: 'TC-15',
    name: 'Regional hardware affinity — local service network preferred',
    rationale: 'Hardware attached to a recommendation must favour vendors with offices in the selected region.',
    form: { location: 'North America', sub_industry: 'C26 Manufacture of Electronic Parts and Components' },
    answers: {
      single: { q2: 4, q3: 4, q4: 3, q5: 4, q14: 3 },
      multiple: { q13: [3], q18: [3], q19: [2] }
    },
    expect: { hardwareLocalPreferred: true }
  }
];

if (typeof module !== 'undefined' && module.exports) module.exports = TEST_CASES;
