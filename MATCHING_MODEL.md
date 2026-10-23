# Standardized Matching Model & Rule Engine

Version `matching-model/1.0` · `matching-engine/1.0`

This layer turns the AI Toolbox catalogue from a keyword list into a **condition-based
matching dataset**, and replaces the old keyword matcher with a transparent rule engine.

## Files

| File | Role |
|---|---|
| `matching_model.js` | Generated catalogue: 107 solutions, 10 scenarios, 9 pain points |
| `recommendation_engine.js` | 4-stage rule engine (normalize → hard filter → rank → combine) |
| `test_cases.js` | 15 standardized test scenarios |
| `run_tests.js` | Test runner with assertions (`node run_tests.js`) |
| `tools/build_matching_model.py` | Regenerates `matching_model.js` from `toolbox_db.js` |
| `tools/verify.js` | Checks inline JS syntax + Vue template compilation |

Regenerate after editing `toolbox_db.js`:

```bash
python tools/build_matching_model.py
node run_tests.js
```

## Solution record

Every solution carries the standardized fields the platform needs for matching,
rather than free-text description alone:

```js
{
  solution_id, name, provider, url,
  scenario_ids:        ['S04'],                 // standardized application scenarios
  pain_point_ids:      ['P02'],                 // manufacturing pain domains
  data_requirements:   ['realtime'],            // realtime | batch | manual
  system_integration:  ['ERP','MES','WMS','PLC','SCADA'],
  deployment_modes:    ['on_premise','cloud','hybrid','mobile'],
  compute_requirements:'edge_gpu',              // edge_gpu | cloud_or_gpu_server | cpu_or_edge
  equipment_types:     ['vision_sensor', ...],
  cost_band:           'low'|'medium'|'high'|'quote_only'|'subscription'|'perpetual'|'unknown',
  cost_amount_million_twd,
  implementation_weeks,
  si_capabilities:     ['camera_lighting_integration', ...],
  api_level:           'full'|'limited'|'none',
  company_sizes:       ['micro','sme','large','enterprise'],
  evidence:            { case_count, verification_status, kpi_published },
  updated_at, limitations: []
}
```

### Capability guard

Supplier-declared pain tags are sometimes too broad (a RAG platform tagging itself for
vision-based defect inspection). The generator drops scenario claims that the declared
technology and equipment cannot support — currently enforced for **S04 Quality
Inspection** (requires vision technology or a vision sensor), **S01 R&D** (requires
design/simulation technology) and **S06 Energy/ESG** (requires energy/ESG technology or
an IoT sensor).

## Application scenarios

| ID | Scenario | Pain point |
|---|---|---|
| S01 | Product R&D and Design | P06 |
| S02 | Production Process and Scheduling | P01 |
| S03 | Supply Chain and Inventory | P04 |
| S04 | Quality Inspection and Yield | P02 |
| S05 | Equipment Maintenance and Reliability | P03 |
| S06 | Facility, Energy and ESG | P05 |
| S07 | Customer Service and GenAI | P07 |
| S08 | Operations Management and BI | P08 |
| S09 | Human Resources and Knowledge | P07 |
| S10 | Logistics and Warehousing | P04 |

Q19 answers are treated as **constraints** (data residency, data silos, budget pressure,
talent gap, benefit uncertainty, risk aversion, weak IT, stability concern), not as pain
domains. Mixing the two produced noisy matches in the earlier prototype.

## Scoring — 100 points

| Component | Weight | Basis |
|---|---|---|
| Requirement fit | 30 | Scenario F1 (24) + primary-scenario bonus (3) + pain overlap (3) |
| Technical compatibility | 25 | Deployment (8) + data readiness (6) + API (6) + integration (5) |
| Expected benefit | 15 | Scenario relevance (9) + published case evidence (6) |
| Cost feasibility | 15 | Budget band vs cost band, implementation window |
| Vendor capability | 10 | Company-size fit (5) + SI capability coverage (5) |
| Evidence confidence | 5 | Case count + verification status |

**Scenario fit uses F1, not recall.** With recall alone, a tool claiming all ten
scenarios scored full marks on every need and dominated every report.

### Status rules

- `recommended` — score ≥ 68 **and** requirement fit ≥ 14 **and** no blocking unmet condition
- `conditional` — strong fit but a data/integration/cost gap must be resolved first
- `excluded` — hard failure: cloud-only against a data-residency requirement, closed
  system when API integration is required, or no manufacturing scenario mapping

**Maturity score never determines ranking.** It sets prerequisites and risk only, so a
low-maturity manufacturer is not locked out of a suitable first project.

## Known limitations

- `cost_band` is derived from free-text pricing; 2 of 107 remain `unknown`.
- `implementation_weeks` is inferred from lead-time text; 12 of 107 are null.
- All evidence is currently `supplier_declared` — no independent verification yet.
- Company size is not collected by the survey and defaults to `sme`.
- Weights are starting hypotheses and should be recalibrated against consultant review.
