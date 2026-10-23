/**
 * Rule-based recommendation engine (matching-engine/1.0).
 *
 * Four stages, per the platform architecture:
 *   1. Normalize   — turn survey answers into a standardized need profile
 *   2. Hard filter — exclude solutions that cannot physically work
 *   3. Rank        — transparent 100-point weighted score
 *   4. Combine     — attach hardware + SI capability + prerequisites + KPIs
 *
 * Design rules:
 *   - Maturity score NEVER determines ranking. It only sets prerequisites and risk.
 *   - "Unknown" is never scored as "bad" — it is surfaced as an unmet condition.
 *   - Every recommendation must explain why it fits AND when it should not be used.
 *
 * Works in the browser (global) and in Node (module.exports).
 */
(function (global) {
  'use strict';

  const MODEL = (typeof MATCHING_MODEL !== 'undefined')
    ? MATCHING_MODEL
    : (typeof require !== 'undefined' ? require('./matching_model.js') : null);

  const HARDWARE = (typeof HARDWARE_DATABASE !== 'undefined')
    ? HARDWARE_DATABASE
    : (typeof require !== 'undefined' ? (() => {
        try { return require('./hardware_db.js'); } catch (e) { return null; }
      })() : null);

  const ENGINE_VERSION = 'matching-engine/1.0';

  const WEIGHTS = {
    requirement_fit: 30,
    technical_compatibility: 25,
    expected_benefit: 15,
    cost_feasibility: 15,
    vendor_capability: 10,
    evidence_confidence: 5
  };

  const BUDGET_ORDER = { low: 0, medium: 1, high: 2 };
  const COST_ORDER = { low: 0, medium: 1, high: 2 };

  const SCENARIO_BY_ID = {};
  (MODEL ? MODEL.scenarios : []).forEach(s => { SCENARIO_BY_ID[s.id] = s; });

  // --------------------------------------------------------------------------
  // Stage 1 — normalize the survey into a need profile
  // --------------------------------------------------------------------------

  /**
   * @param {Object} answers  Vue `answers` object: {single:{}, multiple:{}, matrix:{}}
   * @param {Object} form     Vue `form` object (location, sub_industry, ...)
   * @returns {Object} normalized need
   */
  function deriveNeed(answers, form) {
    answers = answers || {};
    form = form || {};
    const single = answers.single || {};
    const multiple = answers.multiple || {};
    const matrix = answers.matrix || {};

    const scenarioIds = [];
    const painIds = [];
    const constraints = [];

    // Q13 = AI already applied in these fields; Q18 = pain points for next stage
    const q13 = Array.isArray(multiple.q13) ? multiple.q13 : [];
    const q18 = Array.isArray(multiple.q18) ? multiple.q18 : [];
    const q19 = Array.isArray(multiple.q19) ? multiple.q19 : [];

    const push = (arr, v) => { if (v && arr.indexOf(v) === -1) arr.push(v); };

    q13.forEach(i => push(scenarioIds, (MODEL.option_index_to_scenario || {})[i]));
    q18.forEach(i => push(scenarioIds, (MODEL.option_index_to_scenario || {})[i]));

    // Pain domains are derived from the scenarios themselves. Q19 answers are
    // *constraints*, not pain domains — mixing the two was producing noise.
    scenarioIds.forEach(sid => {
      const sc = SCENARIO_BY_ID[sid];
      if (sc) sc.pain_points.forEach(p => push(painIds, p));
    });

    // --- Q19 -> explicit constraints -------------------------------------
    const has = i => q19.indexOf(i) !== -1;
    if (has(6)) constraints.push('data_residency');        // data-leak concern
    if (has(7)) constraints.push('data_not_integrated');   // data silos
    if (has(1)) constraints.push('budget_pressure');       // too costly
    if (has(2)) constraints.push('talent_gap');            // lack of talent
    if (has(3)) constraints.push('benefit_unproven');      // benefits hard to quantify
    if (has(4)) constraints.push('risk_aversion');         // risks hard to assess
    if (has(9)) constraints.push('weak_it_infra');         // inadequate IT
    if (has(10)) constraints.push('stability_concern');    // stability unsatisfactory
    if (has(11)) constraints.push('high_maintenance');     // high maintenance cost

    // --- readiness flags derived from the maturity answers ---
    const q2 = num(single.q2);            // IIoT integration level
    const q3 = num(single.q3);            // data integration level
    const q4 = num(single.q4);            // server / GPU capacity
    const q14 = num(single.q14);          // sourcing model
    const q5 = num(single.q5);            // capital investment level

    const iotReady = q2 >= 2;             // option index >= c (60+)
    const realtimeReady = q2 >= 3;        // option index >= d (80+)
    const enterpriseDataReady = q3 >= 2;
    const gpuAvailable = q4 >= 2;
    const hasVisionPipeline = q13.indexOf(3) !== -1 || q18.indexOf(3) !== -1;

    // Data-leak concern forces on-premise preference
    const dataLeakConcern = constraints.indexOf('data_residency') !== -1;
    const dataNotIntegrated = constraints.indexOf('data_not_integrated') !== -1;

    // Budget band from Q5 (capital investment), tightened by budget_pressure
    let budgetBand = 'unknown';
    if (q5 >= 0) budgetBand = q5 >= 4 ? 'high' : (q5 >= 2 ? 'medium' : 'low');
    if (constraints.indexOf('budget_pressure') !== -1 && budgetBand === 'medium') budgetBand = 'low';

    const companySize = form.company_size || 'sme';

    return {
      scenario_ids: scenarioIds,
      pain_point_ids: painIds,
      constraints,
      region: form.location || 'Other',
      industry: form.sub_industry || '',
      company_size: companySize,
      budget_band: budgetBand,
      deployment_constraint: dataLeakConcern ? 'on_premise' : 'any',
      api_required: dataNotIntegrated || q14 >= 2,
      require_evidence: constraints.indexOf('benefit_unproven') !== -1,
      max_weeks: null,
      readiness: {
        iot: iotReady,
        realtime: realtimeReady,
        enterprise_data: enterpriseDataReady,
        gpu: gpuAvailable,
        vision: hasVisionPipeline,
        labeled_data: 'unknown'
      },
      maturity: {
        overall: num(answers.__overall),
        data_foundation: q2 >= 0 ? q2 * 20 + 20 : null
      },
      sourcing_model: q14 >= 0 ? q14 : null
    };
  }

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : -1;
  }

  // --------------------------------------------------------------------------
  // Stage 2 + 3 — evaluate one solution
  // --------------------------------------------------------------------------

  function overlap(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    let n = 0;
    a.forEach(x => { if (b.indexOf(x) !== -1) n++; });
    return n;
  }

  function ratio(hit, total) {
    return total > 0 ? hit / total : 0;
  }

  function evaluate(solution, need) {
    const reasons = [];
    const unmet = [];
    const risks = [];
    const hardFail = [];

    const needScenarios = need.scenario_ids || [];
    const solScenarios = solution.scenario_ids || [];

    // ---- hard filters -----------------------------------------------------
    if (!solScenarios.length) {
      hardFail.push('Not a manufacturing application scenario (no scenario mapping).');
    }

    if (need.deployment_constraint === 'on_premise') {
      const modes = solution.deployment_modes || [];
      if (modes.indexOf('on_premise') === -1 && modes.indexOf('hybrid') === -1) {
        hardFail.push('Cloud-only deployment conflicts with the on-premise data-residency requirement.');
      }
    }

    if (need.api_required && solution.api_level === 'none') {
      hardFail.push('Closed system with no API cannot integrate with existing MES/ERP.');
    }

    if (hardFail.length) {
      return {
        solution_id: solution.solution_id,
        name: solution.name,
        provider: solution.provider,
        status: 'excluded',
        score: 0,
        breakdown: zeroBreakdown(),
        reasons: [],
        unmet_conditions: hardFail,
        risks: [],
        solution
      };
    }

    // ---- component scores -------------------------------------------------
    // Scenario fit uses F1, not recall. Without the precision term, a tool that
    // claims all 10 scenarios would score full marks on every single need.
    const scenarioHit = overlap(solScenarios, needScenarios);
    const scenarioF1 = (needScenarios.length && solScenarios.length)
      ? (2 * scenarioHit) / (needScenarios.length + solScenarios.length)
      : 0;

    // Primary scenario (the tool's first, strongest claim) earns a bonus.
    const primary = solScenarios[0] || null;
    const primaryHit = primary && needScenarios.indexOf(primary) !== -1;

    const painHit = overlap(solution.pain_point_ids, need.pain_point_ids);
    const painFit = ratio(painHit, (need.pain_point_ids || []).length || 1);

    const requirement_fit = round(
      scenarioF1 * 24 + (primaryHit ? 3 : 0) + painFit * 3
    );
    if (scenarioHit) {
      const names = solScenarios.filter(s => needScenarios.indexOf(s) !== -1)
        .map(s => SCENARIO_BY_ID[s] ? SCENARIO_BY_ID[s].name : s);
      reasons.push('Targets your selected scenario(s): ' + names.join(', ') + '.');
    }

    // technical compatibility (25) = deployment 8 + data 6 + api 6 + integration 5
    let deploymentScore = 8;
    const modes = solution.deployment_modes || [];
    if (need.deployment_constraint === 'on_premise') {
      deploymentScore = modes.indexOf('on_premise') !== -1 ? 8
        : (modes.indexOf('hybrid') !== -1 ? 6 : 0);
      if (deploymentScore === 8) reasons.push('Supports on-premise deployment, keeping plant data inside the site.');
    } else if (modes.indexOf('on_premise') !== -1 || modes.indexOf('hybrid') !== -1) {
      reasons.push('Can be deployed inside the plant if data residency becomes a requirement.');
    }

    const reqFreshness = solution.data_requirements || [];
    let dataScore = 3;
    if (reqFreshness.indexOf('realtime') !== -1) {
      if (need.readiness.realtime) { dataScore = 6; reasons.push('Your IIoT level already supplies the real-time data this solution needs.'); }
      else if (need.readiness.iot) { dataScore = 4; unmet.push('Needs real-time data: current IIoT covers only part of the line — extend coverage first.'); }
      else { dataScore = 1; unmet.push('Needs real-time data, but production equipment is not yet connected to IIoT.'); }
    } else if (reqFreshness.indexOf('batch') !== -1) {
      dataScore = need.readiness.enterprise_data ? 6 : 4;
      if (!need.readiness.enterprise_data) unmet.push('Needs periodic batch data from existing systems; data integration is still limited.');
    } else {
      dataScore = 5;
    }

    let apiScore = 3;
    if (solution.api_level === 'full') { apiScore = 6; if (need.api_required) reasons.push('Full API available for MES/ERP integration.'); }
    else if (solution.api_level === 'limited') { apiScore = 3; if (need.api_required) unmet.push('Limited API (read-only); bidirectional integration will need custom work.'); }
    else { apiScore = 0; }

    const integHit = overlap(solution.system_integration, ['ERP', 'MES', 'WMS', 'PLC', 'SCADA']);
    const integrationScore = Math.min(5, integHit);

    const technical_compatibility = deploymentScore + dataScore + apiScore + integrationScore;

    // expected benefit (15) = scenario relevance 9 + published evidence 6
    const evidence = solution.evidence || {};
    const caseCount = evidence.case_count || 0;
    const expected_benefit = round(scenarioF1 * 9 + (caseCount > 0 ? 6 : 1.8));
    if (caseCount > 0) reasons.push('Has ' + caseCount + ' published customer reference(s).');

    // cost feasibility (15)
    let costScore = 9;
    const band = solution.cost_band;
    if (need.budget_band === 'unknown' || band === 'unknown' || band === 'quote_only') {
      costScore = 8;
      if (band === 'unknown' || band === 'quote_only') unmet.push('Commercial terms are quote-only; budget must be confirmed with the vendor.');
    } else {
      const gap = COST_ORDER[band] - BUDGET_ORDER[need.budget_band];
      if (gap <= 0) { costScore = 15; reasons.push('Cost band fits your stated investment level.'); }
      else if (gap === 1) { costScore = 9; unmet.push('Cost band is one level above your stated investment plan.'); }
      else { costScore = 3; unmet.push('Cost band significantly exceeds your stated investment plan.'); }
    }
    if (need.max_weeks && solution.implementation_weeks && solution.implementation_weeks > need.max_weeks) {
      costScore = Math.max(0, costScore - 4);
      unmet.push('Estimated ' + solution.implementation_weeks + ' weeks exceeds your ' + need.max_weeks + '-week window.');
    }
    const cost_feasibility = round(costScore);

    // vendor capability (10) = size fit 5 + SI capability coverage 5
    const sizes = solution.company_sizes || [];
    const sizeFit = sizes.indexOf(need.company_size) !== -1;
    const sizeScore = sizeFit ? 5 : 2.5;
    if (!sizeFit) risks.push('Vendor has not validated deployments at your company size (' + need.company_size + ').');

    const sc = SCENARIO_BY_ID[(solScenarios[0] || '')] || null;
    const requiredSI = sc ? (sc.si_capabilities || []) : [];
    const siHit = overlap(solution.si_capabilities, requiredSI);
    const siScore = requiredSI.length ? Math.min(5, (siHit / requiredSI.length) * 5) : 3;
    const vendor_capability = round(sizeScore + siScore);

    // evidence confidence (5)
    let evidenceScore = 0;
    if (caseCount > 0) evidenceScore += 3;
    if (caseCount >= 3) evidenceScore += 1;
    if (evidence.verification_status === 'supplier_declared') evidenceScore += 1;
    const evidence_confidence = Math.min(5, round(evidenceScore));
    if (evidence.verification_status === 'unverified') {
      risks.push('No verifiable customer case; benefit claims are unverified.');
    }

    const breakdown = {
      requirement_fit,
      technical_compatibility,
      expected_benefit,
      cost_feasibility,
      vendor_capability,
      evidence_confidence
    };
    const score = round(
      requirement_fit + technical_compatibility + expected_benefit +
      cost_feasibility + vendor_capability + evidence_confidence
    );

    // ---- status -----------------------------------------------------------
    // "recommended" requires both a strong overall score and a genuine
    // scenario fit — a high score from evidence/cost alone is not enough.
    const hasBlockingUnmet = unmet.some(u =>
      /not yet connected|extend coverage|bidirectional integration/.test(u)
    );
    const strongFit = requirement_fit >= 14;
    const status = (hasBlockingUnmet || !strongFit || score < 68) ? 'conditional' : 'recommended';

    // ---- explicit "when NOT to use" ---------------------------------------
    (solution.limitations || []).forEach(l => risks.push(l));

    return {
      solution_id: solution.solution_id,
      name: solution.name,
      provider: solution.provider,
      url: solution.url,
      status,
      score,
      breakdown,
      reasons,
      unmet_conditions: unmet,
      risks,
      // scenarios of this solution that actually matched the need
      matched_scenarios: solScenarios.filter(s => needScenarios.indexOf(s) !== -1),
      implementation_weeks: solution.implementation_weeks,
      cost_band: solution.cost_band,
      deployment_modes: solution.deployment_modes,
      compute_requirements: solution.compute_requirements,
      solution
    };
  }

  function zeroBreakdown() {
    return {
      requirement_fit: 0, technical_compatibility: 0, expected_benefit: 0,
      cost_feasibility: 0, vendor_capability: 0, evidence_confidence: 0
    };
  }

  function round(n) {
    return Math.round((n + Number.EPSILON) * 10) / 10;
  }

  // --------------------------------------------------------------------------
  // Stage 4 — combination with hardware
  // --------------------------------------------------------------------------

  const COMPUTE_TO_HW_TAGS = {
    edge_gpu: ['#GPUIPC', '#MachineVision', '#EdgeAI', '#NVIDIA', '#RTX'],
    cloud_or_gpu_server: ['#GPUIPC', '#EdgeAI', '#NPU'],
    cpu_or_edge: ['#EdgeAI', '#FanlessIPC', '#IPC', '#DINRail', '#Automation']
  };

  function matchHardwareFor(result, need) {
    if (!HARDWARE || !HARDWARE.products) return [];
    const tags = COMPUTE_TO_HW_TAGS[result.compute_requirements] || COMPUTE_TO_HW_TAGS.cpu_or_edge;
    const region = need.region || 'Other';

    const scored = HARDWARE.products.map(prod => {
      let score = 0;
      const pTags = prod.tags || [];
      const ov = pTags.filter(t => tags.indexOf(t) !== -1);
      score += ov.length * 18;
      if (prod.fit === 'High') score += 12;

      const vendor = prod.vendor || {};
      const offices = (vendor.locations_by_region || {})[region] || [];
      let note, local = false;
      if (offices.length) {
        score += 30; local = true;
        const o = offices[0];
        note = vendor.name + ' — ' + o.city + ', ' + o.country + ' (' + o.type + ')';
      } else {
        score += 4;
        note = vendor.name + ' — global HQ ' + (vendor.hq_city || '') + ', ' + (vendor.hq_country || '');
      }
      return { product: prod, score, local, note };
    }).sort((a, b) => b.score - a.score);

    const picked = [];
    const seen = {};
    for (const item of scored) {
      if (!seen[item.product.vendor_id]) {
        picked.push(item); seen[item.product.vendor_id] = 1;
        if (picked.length >= 2) break;
      }
    }
    return picked;
  }

  function buildPrerequisites(result, need) {
    const pre = [];
    const sc = SCENARIO_BY_ID[(result.solution.scenario_ids || [])[0]] || null;
    if (!need.readiness.iot && (result.solution.data_requirements || []).indexOf('realtime') !== -1) {
      pre.push('Connect target equipment to IIoT (OPC UA / Modbus) before model training.');
    }
    if (!need.readiness.enterprise_data && (result.solution.system_integration || []).length) {
      pre.push('Establish a data integration layer between MES/ERP and the AI service.');
    }
    if (need.readiness.labeled_data === 'unknown' && sc && sc.id === 'S04') {
      pre.push('Confirm labelled defect image set exists; if not, budget a labelling phase.');
    }
    if (result.solution.api_level === 'limited') {
      pre.push('Scope custom integration work for the read-only API.');
    }
    if (result.compute_requirements === 'edge_gpu' && !need.readiness.gpu) {
      pre.push('Budget edge GPU hardware (or cloud inference) for vision workloads.');
    }
    return pre;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  function recommend(answers, form, options) {
    options = options || {};
    const need = deriveNeed(answers, form);
    const limit = options.limit || 6;

    if (!need.scenario_ids.length) {
      return {
        engine_version: ENGINE_VERSION,
        need,
        recommended: [],
        conditional: [],
        excluded: [],
        message: 'No application scenario selected (Q13/Q18). Cannot match solutions.'
      };
    }

    const evaluated = (MODEL.solutions || []).map(s => evaluate(s, need));

    const recommended = evaluated.filter(r => r.status === 'recommended')
      .sort((a, b) => b.score - a.score);
    const conditional = evaluated.filter(r => r.status === 'conditional')
      .sort((a, b) => b.score - a.score);
    const excluded = evaluated.filter(r => r.status === 'excluded')
      .sort((a, b) => a.name.localeCompare(b.name));

    const decorate = r => Object.assign({}, r, {
      hardware: matchHardwareFor(r, need),
      prerequisites: buildPrerequisites(r, need)
    });

    const topRecommended = recommended.slice(0, limit).map(decorate);
    const topConditional = conditional.slice(0, limit).map(decorate);

    return {
      engine_version: ENGINE_VERSION,
      need,
      recommended: topRecommended,
      conditional: topConditional,
      excluded,
      stats: {
        evaluated: evaluated.length,
        recommended: recommended.length,
        conditional: conditional.length,
        excluded: excluded.length
      }
    };
  }

  const api = {
    ENGINE_VERSION,
    WEIGHTS,
    deriveNeed,
    evaluate,
    recommend,
    matchHardwareFor,
    buildPrerequisites,
    _model: MODEL
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.RecommendationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
