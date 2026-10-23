"""
Build the standardized matching data model (matching_model.js) from toolbox_db.js.

Transforms free-text supplier fields into normalized, machine-matchable enums:
  scenario_ids, pain_point_ids, data_requirements, system_integration,
  deployment_modes, compute_requirements, cost_band, implementation_weeks,
  si_capabilities, evidence, verification_status, limitations.

Run:  python tools/build_matching_model.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "toolbox_db.js"
OUT = ROOT / "matching_model.js"
TODAY = "2026-10-24"

# ----------------------------------------------------------------------------
# Taxonomy
# ----------------------------------------------------------------------------

SCENARIOS = [
    dict(id="S01", name="Product R&D and Design", group="Engineering",
         pain_points=["P06"], required_data=["cad_files", "design_history"],
         required_equipment=["documents", "enterprise_system"],
         compute="cloud_or_gpu_server",
         si_capabilities=["cad_plm_integration"],
         kpi=["design cycle time", "first-pass design yield", "engineering change orders"],
         description="Generative/analytical AI applied to design exploration, simulation and engineering change management."),
    dict(id="S02", name="Production Process and Scheduling", group="Operations",
         pain_points=["P01"], required_data=["production_orders", "machine_status", "cycle_time"],
         required_equipment=["enterprise_system", "plc_controller"],
         compute="cpu_or_edge",
         si_capabilities=["mes_aps_integration", "plc_scada_integration"],
         kpi=["OEE", "on-time delivery", "changeover time"],
         description="APS, dynamic scheduling and closed-loop process parameter optimization."),
    dict(id="S03", name="Supply Chain and Inventory", group="Operations",
         pain_points=["P04"], required_data=["inventory_records", "demand_history", "supplier_leadtime"],
         required_equipment=["enterprise_system"],
         compute="cpu_or_edge",
         si_capabilities=["erp_scm_integration"],
         kpi=["inventory turns", "stockout rate", "forecast accuracy"],
         description="Demand forecasting, safety-stock optimization and supplier risk analytics."),
    dict(id="S04", name="Quality Inspection and Yield", group="Quality",
         pain_points=["P02"], required_data=["images", "defect_labels", "inspection_standard"],
         required_equipment=["vision_sensor"],
         compute="edge_gpu",
         si_capabilities=["camera_lighting_integration", "aoi_integration", "mes_quality_integration"],
         kpi=["false reject rate", "escape rate", "inspection time per unit"],
         description="Machine vision defect detection, AOI and yield root-cause analysis."),
    dict(id="S05", name="Equipment Maintenance and Reliability", group="Operations",
         pain_points=["P03"], required_data=["sensor_timeseries", "maintenance_log", "failure_history"],
         required_equipment=["iot_sensor", "plc_controller"],
         compute="cpu_or_edge",
         si_capabilities=["plc_scada_integration", "historian_integration", "cmms_integration"],
         kpi=["unplanned downtime", "MTBF", "maintenance cost", "early-warning lead time"],
         description="Predictive maintenance, anomaly detection and remaining-useful-life estimation."),
    dict(id="S06", name="Facility, Energy and ESG", group="Sustainability",
         pain_points=["P05"], required_data=["energy_meters", "utility_data", "emission_factors"],
         required_equipment=["iot_sensor", "enterprise_system"],
         compute="cpu_or_edge",
         si_capabilities=["metering_protocol_integration", "ems_integration"],
         kpi=["kWh per unit", "carbon intensity", "energy cost", "safety incidents"],
         description="Energy monitoring, carbon accounting and plant-safety event detection."),
    dict(id="S07", name="Customer Service and GenAI", group="Business",
         pain_points=["P07"], required_data=["knowledge_base", "ticket_history"],
         required_equipment=["documents", "enterprise_system"],
         compute="cloud_or_gpu_server",
         si_capabilities=["crm_integration", "llm_gateway", "data_masking"],
         kpi=["first response time", "resolution rate", "CSAT"],
         description="Conversational assistants and generative AI for commercial service workflows."),
    dict(id="S08", name="Operations Management and BI", group="Business",
         pain_points=["P08"], required_data=["kpi_definitions", "multi_source_data"],
         required_equipment=["enterprise_system", "plc_controller"],
         compute="cpu_or_edge",
         si_capabilities=["bi_etl_integration", "data_warehouse"],
         kpi=["report latency", "data completeness", "decision cycle time"],
         description="Unified dashboards, situation rooms and cross-department decision support."),
    dict(id="S09", name="Human Resources and Knowledge", group="Business",
         pain_points=["P07"], required_data=["sop_documents", "training_records"],
         required_equipment=["documents"],
         compute="cloud_or_gpu_server",
         si_capabilities=["document_management_integration", "sso_integration"],
         kpi=["onboarding time", "knowledge retrieval accuracy"],
         description="Knowledge assistants, SOP retrieval and workforce planning."),
    dict(id="S10", name="Logistics and Warehousing", group="Operations",
         pain_points=["P04"], required_data=["wms_data", "shipment_records"],
         required_equipment=["enterprise_system", "identification"],
         compute="cpu_or_edge",
         si_capabilities=["wms_erp_integration", "barcode_rfid_integration"],
         kpi=["picking accuracy", "dock-to-stock time", "inventory accuracy"],
         description="Warehouse optimization, route planning and automated goods identification."),
]

PAIN_POINTS = [
    dict(id="P01", name="Scheduling and Delivery", scenarios=["S02"]),
    dict(id="P02", name="Quality and Yield", scenarios=["S04"]),
    dict(id="P03", name="Equipment and Maintenance", scenarios=["S05"]),
    dict(id="P04", name="Inventory and Supply Chain", scenarios=["S03", "S10"]),
    dict(id="P05", name="ESG, Facility and Safety", scenarios=["S06"]),
    dict(id="P06", name="R&D and Design", scenarios=["S01"]),
    dict(id="P07", name="Human-AI Collaboration and Knowledge", scenarios=["S07", "S09"]),
    dict(id="P08", name="Dashboard and Situation Center", scenarios=["S08"]),
    dict(id="P09", name="Other / Unclassified", scenarios=[]),
]

PAIN_NUM_TO_ID = {i + 1: p["id"] for i, p in enumerate(PAIN_POINTS)}

# Question option index (q13 / q18 share the same option order) -> scenario
OPTION_INDEX_TO_SCENARIO = {
    0: "S01", 1: "S02", 2: "S03", 3: "S04", 4: "S05", 5: "S06",
    6: "S06", 7: "S07", 8: "S08", 9: "S09", 10: "S10",
}

# q19 challenge index -> pain points
Q19_INDEX_TO_PAIN = {
    0: ["P09"], 1: ["P09"], 2: ["P07"], 3: ["P08"], 4: ["P09"], 5: ["P07"],
    6: ["P09"], 7: ["P08"], 8: ["P07"], 9: ["P09"], 10: ["P03"],
    11: ["P03"], 12: ["P05"], 13: ["P09"],
}


# ----------------------------------------------------------------------------
# Normalizers
# ----------------------------------------------------------------------------

def norm_deployment(text):
    t = str(text or "")
    modes = []
    if "本地端" in t:
        modes.append("on_premise")
    if "雲端" in t:
        modes.append("cloud")
    if "混合" in t:
        modes.append("hybrid")
    if "Android" in t or "APP" in t or "手機" in t:
        modes.append("mobile")
    if not modes and ("皆可" in t or "以上皆可" in t or "可配合" in t):
        modes = ["on_premise", "cloud", "hybrid"]
    return modes or ["on_premise"]


def norm_api(text):
    t = str(text or "")
    if "封閉" in t:
        return "none"
    if "完整 API" in t:
        return "full"
    if "有限 API" in t:
        return "limited"
    return "limited"


def norm_data_freshness(text):
    t = str(text or "")
    levels = []
    if "即時" in t:
        levels.append("realtime")
    if "批次" in t:
        levels.append("batch")
    if "手動" in t:
        levels.append("manual")
    return levels or ["batch"]


def norm_equipment(text):
    t = str(text or "")
    eq = []
    if "影像" in t or "光學" in t:
        eq.append("vision_sensor")
    if "識別與讀取" in t:
        eq.append("identification")
    if "物理訊號" in t:
        eq.append("iot_sensor")
    if "控制器與機台" in t:
        eq.append("plc_controller")
    if "資訊系統與資料庫" in t:
        eq.append("enterprise_system")
    if "文書檔案" in t:
        eq.append("documents")
    return eq or ["documents"]


def norm_integration(equipment, api):
    targets = []
    if "enterprise_system" in equipment:
        targets += ["ERP", "MES", "WMS"]
    if "plc_controller" in equipment:
        targets += ["PLC", "SCADA"]
    if "identification" in equipment:
        targets += ["Barcode", "RFID"]
    if "iot_sensor" in equipment:
        targets += ["OPC UA", "Modbus", "IoT Gateway"]
    return targets


def norm_company_sizes(text):
    t = str(text or "")
    sizes = []
    if "9人以下" in t:
        sizes.append("micro")
    if "10人~200人" in t:
        sizes.append("sme")
    if "201~1000人" in t:
        sizes.append("large")
    if "1001人以上" in t:
        sizes.append("enterprise")
    return sizes or ["sme", "large"]


def norm_compute(tech, benefit):
    t = (str(tech or "") + " " + str(benefit or "")).lower()
    if any(k in t for k in ["llm", "rag", "gpt", "claude", "gemini", "大語言", "生成式", "nlp"]):
        return "cloud_or_gpu_server"
    if any(k in t for k in ["cnn", "yolo", "object detection", "影像", "視覺", "aoi", "image"]):
        return "edge_gpu"
    return "cpu_or_edge"


def norm_cost(text):
    t = str(text or "").strip()
    low = t.lower()
    if not t or "tbd" in low or "未定" in t:
        return "unknown", None
    band = "quote_only"
    amount = None
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*萬", t)
    if m:
        amount = float(m.group(1).replace(",", ""))
        band = "high" if amount >= 100 else ("medium" if amount >= 30 else "low")
    elif "報價" in t or "專案" in t:
        band = "quote_only"
    elif "訂閱" in t or "/m" in low or "/月" in t:
        band = "subscription"
    elif "買斷" in t:
        band = "perpetual"
    return band, amount


def norm_weeks(text):
    t = str(text or "").strip()
    if not t:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if not m:
        return None
    n = float(m.group(1))
    if "天" in t:
        w = n / 7.0
    elif "月" in t:
        w = n * 4.33
    elif "年" in t:
        w = n * 52.0
    elif "週" in t or "周" in t:
        w = n
    else:
        w = n  # bare numbers in the source are weeks
    return round(max(0.5, min(w, 78.0)), 1)


def norm_si_capabilities(equipment, api):
    caps = []
    if "vision_sensor" in equipment:
        caps.append("camera_lighting_integration")
    if "plc_controller" in equipment:
        caps.append("plc_scada_integration")
    if "enterprise_system" in equipment:
        caps.append("erp_mes_integration")
    if "iot_sensor" in equipment:
        caps.append("iot_gateway_integration")
    if "identification" in equipment:
        caps.append("barcode_rfid_integration")
    if "documents" in equipment:
        caps.append("document_digitization")
    if api == "full":
        caps.append("api_development")
    return caps


def norm_pain_ids(pain_tags):
    ids = []
    for tag in pain_tags or []:
        m = re.match(r"\s*(\d+)", str(tag))
        if m:
            pid = PAIN_NUM_TO_ID.get(int(m.group(1)))
            if pid and pid not in ids:
                ids.append(pid)
    return ids


def pain_to_scenarios(pain_ids):
    out = []
    by_id = {p["id"]: p for p in PAIN_POINTS}
    for pid in pain_ids:
        for s in by_id.get(pid, {}).get("scenarios", []):
            if s not in out:
                out.append(s)
    return out


# --- capability guard -------------------------------------------------------
# A supplier's self-declared pain tags are sometimes too broad (e.g. a RAG
# platform tagging itself for vision-based defect inspection). Drop scenario
# claims that the declared technology and equipment cannot actually support.
CAPABILITY_SIGNALS = {
    "S04": {
        "tech": ["cnn", "yolo", "object detection", "image", "vision", "aoi",
                 "defect", "影像", "視覺", "檢測", "辨識"],
        "equipment": ["vision_sensor"],
    },
    "S01": {
        "tech": ["design", "cad", "simulation", "generative design", "optimi",
                 "設計", "研發", "模擬"],
        "equipment": [],
    },
    "S06": {
        "tech": ["energy", "carbon", "esg", "emission", "能耗", "碳", "能源", "節能", "工安", "安全"],
        "equipment": ["iot_sensor"],
    },
}


def apply_capability_guard(scenarios, tech_text, equipment):
    t = str(tech_text or "").lower()
    kept = []
    for sid in scenarios:
        rule = CAPABILITY_SIGNALS.get(sid)
        if not rule:
            kept.append(sid)
            continue
        tech_ok = any(k.lower() in t for k in rule["tech"])
        eq_ok = any(e in equipment for e in rule["equipment"])
        if tech_ok or eq_ok:
            kept.append(sid)
    return kept


def count_cases(text):
    t = str(text or "").strip()
    if not t or t.lower() in ("none", "n/a", "無"):
        return 0
    return len([p for p in re.split(r"[、,;；]", t) if p.strip()])


def build_limitations(api, deployment, sizes, evidence_count):
    lim = []
    if api == "none":
        lim.append("No API: cannot integrate with MES/ERP; manual export only.")
    elif api == "limited":
        lim.append("Limited API: read-only or database extraction; no bidirectional control.")
    if len(deployment) == 1 and deployment[0] == "cloud":
        lim.append("Cloud-only: unsuitable where plant data cannot leave the site.")
    if "enterprise" not in sizes:
        lim.append("Not validated for 1000+ employee, multi-site enterprise rollouts.")
    if evidence_count == 0:
        lim.append("No verifiable customer case published; treat benefit claims as unverified.")
    return lim


# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------

def main():
    raw = SRC.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";")
    tools = json.loads(raw)

    solutions = []
    for idx, t in enumerate(tools):
        name_en = (t.get("name_en") or t.get("name") or "").strip()
        provider_en = (t.get("provider_en") or t.get("provider") or "").strip()

        equipment = norm_equipment(t.get("equipment"))
        api = norm_api(t.get("api"))
        deployment = norm_deployment(t.get("deployment"))
        sizes = norm_company_sizes(t.get("company_size"))
        pain_ids = norm_pain_ids(t.get("pain_tags"))
        scenarios = pain_to_scenarios(pain_ids)
        tech_text = (t.get("tech_en") or "") + " " + (t.get("tech") or "") + " " + (t.get("benefit_en") or "") + " " + (t.get("benefit") or "")
        scenarios = apply_capability_guard(scenarios, tech_text, equipment)
        cost_band, cost_amount = norm_cost(t.get("pricing"))
        weeks = norm_weeks(t.get("lead_time"))
        evidence_count = count_cases(t.get("cases_en") or t.get("cases"))

        solutions.append({
            "solution_id": f"SOL-{idx + 1:03d}",
            "name": name_en,
            "provider": provider_en,
            "url": t.get("url") or "",
            # --- standardized matching fields ---
            "scenario_ids": scenarios,
            "pain_point_ids": pain_ids,
            "data_requirements": norm_data_freshness(t.get("data_need")),
            "system_integration": norm_integration(equipment, api),
            "deployment_modes": deployment,
            "compute_requirements": norm_compute(t.get("tech_en") or t.get("tech"),
                                                t.get("benefit_en") or t.get("benefit")),
            "equipment_types": equipment,
            "cost_band": cost_band,
            "cost_amount_million_twd": cost_amount,
            "implementation_weeks": weeks,
            "si_capabilities": norm_si_capabilities(equipment, api),
            "api_level": api,
            "company_sizes": sizes,
            "evidence": {
                "case_count": evidence_count,
                "verification_status": "supplier_declared" if evidence_count else "unverified",
                "kpi_published": evidence_count > 0,
            },
            # --- traceability ---
            "updated_at": TODAY,
            "limitations": build_limitations(api, deployment, sizes, evidence_count),
            # --- descriptive (English only) ---
            "tech": (t.get("tech_en") or t.get("tech") or "").strip(),
            "benefit": (t.get("benefit_en") or t.get("benefit") or "").strip(),
            "deployment_note": (t.get("deployment_en") or "").strip(),
            "pricing_note": (t.get("pricing_en") or "").strip(),
            "lead_time_note": (t.get("lead_time_en") or "").strip(),
            "cases_note": (t.get("cases_en") or "").strip(),
        })

    model = {
        "version": "1.0.0",
        "generated_at": TODAY,
        "schema_version": "matching-model/1.0",
        "counts": {
            "solutions": len(solutions),
            "scenarios": len(SCENARIOS),
            "pain_points": len(PAIN_POINTS),
        },
        "scenarios": SCENARIOS,
        "pain_points": PAIN_POINTS,
        "option_index_to_scenario": OPTION_INDEX_TO_SCENARIO,
        "q19_index_to_pain": Q19_INDEX_TO_PAIN,
        "solutions": solutions,
    }

    js = (
        "// AUTO-GENERATED by tools/build_matching_model.py — do not edit by hand.\n"
        "// Standardized matching data model (matching-model/1.0).\n"
        "const MATCHING_MODEL = "
        + json.dumps(model, ensure_ascii=False, indent=2)
        + ";\n\n"
        "if (typeof module !== 'undefined' && module.exports) { module.exports = MATCHING_MODEL; }\n"
    )
    OUT.write_text(js, encoding="utf-8")

    # Report coverage
    with_scenario = sum(1 for s in solutions if s["scenario_ids"])
    with_weeks = sum(1 for s in solutions if s["implementation_weeks"])
    with_cost = sum(1 for s in solutions if s["cost_band"] != "unknown")
    with_case = sum(1 for s in solutions if s["evidence"]["case_count"] > 0)
    print(f"Wrote {OUT.name}: {len(solutions)} solutions")
    print(f"  scenario-mapped : {with_scenario}/{len(solutions)}")
    print(f"  cost-banded     : {with_cost}/{len(solutions)}")
    print(f"  lead-time known : {with_weeks}/{len(solutions)}")
    print(f"  has case study  : {with_case}/{len(solutions)}")


if __name__ == "__main__":
    main()
