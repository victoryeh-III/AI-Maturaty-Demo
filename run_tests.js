/**
 * Test runner for the rule-based recommendation engine.
 * Usage:  node run_tests.js
 */
const path = require('path');

const MODEL = require('./matching_model.js');
global.MATCHING_MODEL = MODEL;

const HW = require('./hardware_db.js');
global.HARDWARE_DATABASE = HW;

const Engine = require('./recommendation_engine.js');
const CASES = require('./test_cases.js');

let passed = 0, failed = 0;
const failures = [];

function check(caseId, label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`${caseId} :: ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function scenarioOf(result) {
  if (!result) return null;
  if (result.matched_scenarios && result.matched_scenarios.length) return result.matched_scenarios[0];
  return (result.solution.scenario_ids || [])[0] || null;
}

function fmtTop(r) {
  if (!r) return 'none';
  return `${r.solution_id} ${r.name.slice(0, 38)} [${scenarioOf(r)}] ${r.score}`;
}

console.log('='.repeat(78));
console.log('Rule-based Recommendation Engine — Test Suite');
console.log(`Engine ${Engine.ENGINE_VERSION} | Model ${MODEL.version} | ${MODEL.counts.solutions} solutions`);
console.log('='.repeat(78));

for (const tc of CASES) {
  const out = Engine.recommend(tc.answers, tc.form, { limit: 10 });
  const e = tc.expect || {};
  const top = out.recommended[0] || out.conditional[0] || null;
  const all = out.recommended.concat(out.conditional);

  console.log(`\n[${tc.id}] ${tc.name}`);
  console.log(`   need scenarios: ${out.need.scenario_ids.join(',') || '-'}  |  pains: ${out.need.pain_point_ids.join(',') || '-'}`);
  console.log(`   stats: ${out.stats.recommended} recommended / ${out.stats.conditional} conditional / ${out.stats.excluded} excluded`);
  console.log(`   top: ${fmtTop(top)}`);

  if (e.topScenario) {
    check(tc.id, `top scenario == ${e.topScenario}`, top && scenarioOf(top) === e.topScenario,
      top ? `got ${scenarioOf(top)} (${top.name})` : 'no result');
  }
  if (typeof e.minRecommended === 'number') {
    check(tc.id, `recommended >= ${e.minRecommended}`, out.stats.recommended >= e.minRecommended,
      `got ${out.stats.recommended}`);
  }
  if (typeof e.maxRecommended === 'number') {
    check(tc.id, `recommended <= ${e.maxRecommended}`, out.stats.recommended <= e.maxRecommended,
      `got ${out.stats.recommended}`);
  }
  if (typeof e.minExcluded === 'number') {
    check(tc.id, `excluded >= ${e.minExcluded}`, out.stats.excluded >= e.minExcluded,
      `got ${out.stats.excluded}`);
  }
  if (e.requireConditional) {
    check(tc.id, 'has conditional results', out.stats.conditional >= 1,
      `got ${out.stats.conditional}`);
  }
  if (e.requirePrerequisiteMentioningIIoT) {
    const found = all.some(r => (r.prerequisites || []).some(p => /IIoT/i.test(p)));
    check(tc.id, 'a prerequisite mentions IIoT', found);
  }
  if (e.topMustBeIn) {
    check(tc.id, `top scenario in [${e.topMustBeIn.join(',')}]`,
      top && e.topMustBeIn.indexOf(scenarioOf(top)) !== -1,
      top ? `got ${scenarioOf(top)}` : 'no result');
  }
  if (e.excludedReasonPattern) {
    const re = new RegExp(e.excludedReasonPattern, 'i');
    const found = out.excluded.some(r => (r.unmet_conditions || []).some(u => re.test(u)));
    check(tc.id, `excluded reason matches /${e.excludedReasonPattern}/`, found);
  }
  if (e.recommendedMustSupportOnPremise) {
    const bad = out.recommended.filter(r => {
      const m = r.deployment_modes || [];
      return m.indexOf('on_premise') === -1 && m.indexOf('hybrid') === -1;
    });
    check(tc.id, 'all recommended support on-premise/hybrid', bad.length === 0,
      bad.length ? `violations: ${bad.map(b => b.name).join(', ')}` : '');
  }
  if (e.requireIntegrationReason) {
    const found = out.excluded.some(r => (r.unmet_conditions || []).some(u => /integrat|no API/i.test(u)));
    check(tc.id, 'integration exclusion reason present', found);
  }
  if (e.requireBudgetCondition) {
    const found = all.some(r => (r.unmet_conditions || []).some(u => /cost band|investment plan/i.test(u)));
    check(tc.id, 'budget unmet condition present', found);
  }
  if (typeof e.minDistinctScenariosInTop === 'number') {
    const set = new Set(out.recommended.slice(0, 5).map(scenarioOf).filter(Boolean));
    check(tc.id, `distinct scenarios in top >= ${e.minDistinctScenariosInTop}`,
      set.size >= e.minDistinctScenariosInTop, `got ${set.size}: ${[...set].join(',')}`);
  }
  if (e.forbiddenNamePatterns) {
    const re = new RegExp(e.forbiddenNamePatterns.join('|'), 'i');
    const hit = all.filter(r => re.test(r.name));
    check(tc.id, 'no non-manufacturing tools recommended', hit.length === 0,
      hit.length ? hit.map(h => h.name).join(', ') : '');
  }
  if (e.maxScore) {
    const bad = all.filter(r => r.score > e.maxScore);
    check(tc.id, `all scores <= ${e.maxScore}`, bad.length === 0);
  }
  if (e.requireReasons) {
    const bad = out.recommended.filter(r => !(r.reasons || []).length);
    check(tc.id, 'every recommendation has a reason', bad.length === 0,
      bad.length ? bad.map(b => b.name).join(', ') : '');
  }
  if (e.excludedAllExplained) {
    const bad = out.excluded.filter(r => !(r.unmet_conditions || []).length);
    check(tc.id, 'every exclusion is explained', bad.length === 0);
  }
  if (e.verifyBreakdown) {
    const bad = all.filter(r => {
      const b = r.breakdown;
      const sum = b.requirement_fit + b.technical_compatibility + b.expected_benefit +
        b.cost_feasibility + b.vendor_capability + b.evidence_confidence;
      const caps = b.requirement_fit <= 30 && b.technical_compatibility <= 25 &&
        b.expected_benefit <= 15 && b.cost_feasibility <= 15 &&
        b.vendor_capability <= 10 && b.evidence_confidence <= 5;
      return Math.abs(sum - r.score) > 0.15 || !caps;
    });
    check(tc.id, 'breakdown sums to score and respects caps', bad.length === 0,
      bad.length ? bad.map(b => `${b.name}:${b.score}`).join(', ') : '');
  }
  if (e.hardwareLocalPreferred) {
    const anyLocal = all.slice(0, 3).some(r => (r.hardware || []).some(h => h.local));
    check(tc.id, 'hardware favours a local service network', anyLocal);
  }
  if (e.deterministic) {
    const out2 = Engine.recommend(tc.answers, tc.form, { limit: 10 });
    const sig = o => o.recommended.map(r => r.solution_id + ':' + r.score).join('|');
    check(tc.id, 'output is deterministic', sig(out) === sig(out2));
  }
}

// --- global invariants -------------------------------------------------------
console.log('\n' + '-'.repeat(78));
console.log('Global invariants');
const sample = Engine.recommend(CASES[0].answers, CASES[0].form, { limit: 10 });
check('GLOBAL', 'engine evaluates the full catalog',
  sample.stats.evaluated === MODEL.counts.solutions,
  `evaluated ${sample.stats.evaluated} of ${MODEL.counts.solutions}`);
check('GLOBAL', 'no solution is both recommended and excluded',
  sample.recommended.every(r => r.status === 'recommended'));
check('GLOBAL', 'weights total 100',
  Object.values(Engine.WEIGHTS).reduce((a, b) => a + b, 0) === 100);
console.log(`   evaluated: ${sample.stats.evaluated} / ${MODEL.counts.solutions}`);
console.log(`   weights total: ${Object.values(Engine.WEIGHTS).reduce((a, b) => a + b, 0)}`);

console.log('\n' + '='.repeat(78));
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('All assertions passed.');
}
console.log('='.repeat(78));
