# Seed a full cleaning + maintenance test bed for the vp kiosk.
#
# Run with:
#
#     mix run priv/scripts/seed_cleaning_maintenance_test.exs
#
# Idempotent — re-running is safe, existing rows are reused. Publisher
# fires on every save so the vp mirror + WorkstationEquipment table
# refresh automatically.
#
# What lands on the DB:
#
#   * "Blenders (test)" equipment category (id resolved by name).
#   * Two equipment units attached to Blending #1 in that category:
#       - "V-blender 100L · SN-TEST-VB100"
#       - "V-blender 500L · SN-TEST-VB500"
#   * Workstation cleaning cadence: weekly. Maintenance cadence: monthly.
#     Cached scalars nudged to "next due tomorrow" so the picker chip
#     is visible.
#   * Eight form templates (four workstation-scoped phases + four
#     equipment-scoped phases) with a tiny schema each — one text +
#     one yes/no field so the FormRenderer walk-through actually
#     renders something.
#   * Assignments:
#       - Workstation cleaning_start/_end + maintenance_start/_end on
#         Blending #1.
#       - Equipment cleaning_start/_end + maintenance_start/_end on
#         the "Blenders (test)" category → both machines inherit.
#   * Attempt an in_progress MO on Blending #1 for the Jobs tab.
#     Raw insert (bypasses booking + cascade — dev only). Logged if
#     it can't land so you can create one via the UI.

require Logger

import Ecto.Query

alias Backend.Accounts.User
alias Backend.Companies.Company
alias Backend.Equipment.{Category, CategoryFormAssignment, Categories, Equipment}
alias Backend.Forms.FormTemplate
alias Backend.Items.Item
alias Backend.Production.{
  ManufacturingOrder,
  ManufacturingOrderStep,
  Workstation,
  WorkstationFormAssignment,
  WorkstationGroup
}
alias Backend.Repo

# ── Prereqs ────────────────────────────────────────────────────────

company = Repo.one!(from c in Company, order_by: c.id, limit: 1)
actor = Repo.one!(from u in User, where: u.company_id == ^company.id and u.is_admin == true, limit: 1)
ws = Repo.one!(from w in Workstation, where: w.company_id == ^company.id and w.name == "Blending #1")

IO.puts("Company: #{company.name} (id=#{company.id})")
IO.puts("Actor: #{actor.email} (id=#{actor.id})")
IO.puts("Workstation: #{ws.name} (id=#{ws.id}, uuid=#{ws.uuid})")

# ── Category ───────────────────────────────────────────────────────

category_name = "Blenders (test)"

category =
  case Repo.get_by(Category, company_id: company.id, name: category_name) do
    nil ->
      {:ok, cat} = Categories.create(company.id, %{"name" => category_name, "notes" => "Seeded for cleaning + maintenance kiosk tests."}, actor)
      IO.puts("Created category: #{cat.name} (id=#{cat.id})")
      cat

    existing ->
      IO.puts("Reusing category: #{existing.name} (id=#{existing.id})")
      existing
  end

# ── Equipment units (attached to Blending #1) ──────────────────────

# Resolve the two V-blender items by name so the equipment display
# names on the kiosk read as real machines instead of the first
# equipment-type item that happens to be in the catalog.
vblender_100 =
  Repo.one!(from i in Item, where: i.item_type == "equipment" and ilike(i.name, "%blender 100%"))

vblender_500 =
  Repo.one!(from i in Item, where: i.item_type == "equipment" and ilike(i.name, "%blender 500%"))

equipment_specs = [
  %{serial: "SN-TEST-VB100", model: "V-blender 100 L", item: vblender_100},
  %{serial: "SN-TEST-VB500", model: "V-blender 500 L", item: vblender_500}
]

Enum.each(equipment_specs, fn spec ->
  case Repo.get_by(Equipment, company_id: company.id, serial_number: spec.serial) do
    nil ->
      # Bypass Backend.Equipment.create because it drags along a
      # birth-event + broadcast pipeline; for seed we insert directly.
      {:ok, eq} =
        %Equipment{}
        |> Equipment.changeset(%{
          "company_id" => company.id,
          "item_id" => spec.item.id,
          "category_id" => category.id,
          "workstation_id" => ws.id,
          "serial_number" => spec.serial,
          "model" => spec.model,
          "manufacturer" => "Vita Test Rig",
          "status" => "in_service",
          "acquired_at" => DateTime.utc_now() |> DateTime.truncate(:second),
          "created_by_id" => actor.id,
          "updated_by_id" => actor.id
        })
        |> Repo.insert()

      IO.puts("Created equipment: #{eq.serial_number} → #{ws.name} (id=#{eq.id})")

    existing ->
      # Ensure attachment + item stays fresh so a re-run corrects
      # anything that got seeded with the wrong FK on a prior pass.
      {:ok, _} =
        existing
        |> Ecto.Changeset.change(%{
          item_id: spec.item.id,
          workstation_id: ws.id,
          category_id: category.id,
          status: "in_service"
        })
        |> Repo.update()

      IO.puts("Reusing equipment: #{existing.serial_number} (id=#{existing.id})")
  end
end)

# ── Cadence on the workstation ─────────────────────────────────────
# Cleaning weekly, maintenance monthly. Set "next due tomorrow" so
# the picker's due-soon chips are visibly populated.

tomorrow = Date.utc_today() |> Date.add(1)

{:ok, ws} =
  ws
  |> Ecto.Changeset.change(%{
    cleaning_periodicity: "weekly",
    cleaning_periodicity_interval: 1,
    next_cleaning_due_at: tomorrow,
    maintenance_periodicity: "monthly",
    maintenance_periodicity_interval: 1,
    next_maintenance_due_at: tomorrow
  })
  |> Repo.update()

IO.puts("Set cleaning + maintenance cadence on #{ws.name} (both due #{tomorrow})")

# ── Form templates ─────────────────────────────────────────────────

wrap_schema = fn fields ->
  %{"fields" => fields, "per_equipment_fields" => nil}
end

# Distinct, realistic pharma-grade schemas — one per trigger so the
# operator can eyeball which form they're on. Each list is small
# (5–8 fields) so the kiosk walk-through stays fast enough to test
# end-to-end without fatigue.
schemas = %{
  "workstation_start" =>
    wrap_schema.([
      %{"id" => "ack_bmr", "type" => "acknowledgement", "label" => "I've read the BMR for today's batch", "required" => true},
      %{"id" => "ppe_worn", "type" => "yes_no", "label" => "PPE on (glasses, gloves, hairnet)?", "required" => true},
      %{"id" => "surfaces_clean", "type" => "yes_no", "label" => "Workstation surfaces dry + clean?", "required" => true},
      %{"id" => "batch_no", "type" => "text", "label" => "Batch number I'm about to run", "required" => true, "placeholder" => "e.g. BL-2026-041"},
      %{"id" => "room_temp", "type" => "number", "label" => "Room temperature (°C)", "required" => true, "placeholder" => "20"},
      %{"id" => "room_humidity", "type" => "number", "label" => "Room humidity (%)", "required" => true, "placeholder" => "45"}
    ]),
  "workstation_end" =>
    wrap_schema.([
      %{"id" => "yield_kg", "type" => "number", "label" => "Actual yield (kg)", "required" => true},
      %{"id" => "waste_ok", "type" => "yes_no", "label" => "Waste disposed correctly?", "required" => true},
      %{"id" => "tools_returned", "type" => "yes_no", "label" => "Tools + PPE returned to marked locations?", "required" => true},
      %{"id" => "shift_rating", "type" => "rating", "label" => "How was the run? (1 rough → 5 smooth)", "required" => true, "max_rating" => 5},
      %{"id" => "handover", "type" => "text", "label" => "Handover notes for next shift", "required" => false, "placeholder" => "Anything the next operator needs to know"}
    ]),
  # Cleaning + maintenance forms deliberately DO NOT re-ask what
  # the operator is cleaning — the ScopePicker on the confirm
  # screen already answered that (workstation vs specific machine).
  # These schemas are downstream of that choice: setup, safety,
  # verification, signoff. Everything is pharma-grade + traceable.
  "cleaning_start" =>
    wrap_schema.([
      %{"id" => "ack_loto_clean", "type" => "acknowledgement", "label" => "LOTO applied — power + pressure isolated, my padlock on the isolator", "required" => true},
      %{"id" => "product_removed", "type" => "yes_no", "label" => "Bulk product + used consumables removed from the cell?", "required" => true},
      %{"id" => "dry_wiped", "type" => "yes_no", "label" => "Loose residue dry-wiped BEFORE wet cleaning starts?", "required" => true},
      %{"id" => "cell_isolated", "type" => "yes_no", "label" => "Adjacent workstations screened / informed cleaning is in progress?", "required" => true},
      %{"id" => "protocol",
        "type" => "dropdown",
        "label" => "Cleaning protocol to run",
        "required" => true,
        "options" => [
          %{"id" => "type_a_rinse", "label" => "Type A · rinse-down between same-product batches"},
          %{"id" => "type_b_sanitize", "label" => "Type B · rinse + sanitize (same product family)"},
          %{"id" => "type_c_allergen", "label" => "Type C · allergen changeover (full cycle)"},
          %{"id" => "type_d_shutdown", "label" => "Type D · end-of-campaign deep clean"}
        ]},
      %{"id" => "agent_lot", "type" => "text", "label" => "Cleaning agent lot number(s)", "required" => true, "placeholder" => "one per line if multiple"},
      %{"id" => "contact_time_min", "type" => "number", "label" => "Planned detergent contact time (min)", "required" => true, "placeholder" => "e.g. 15"},
      %{"id" => "chem_ppe", "type" => "yes_no", "label" => "Chemical PPE on (gloves, apron, splash goggles)?", "required" => true}
    ]),
  "cleaning_end" =>
    wrap_schema.([
      %{"id" => "agents_rinsed", "type" => "acknowledgement", "label" => "All cleaning agents fully rinsed from every contact surface", "required" => true},
      %{"id" => "visual_clean", "type" => "yes_no", "label" => "Visual inspection: no residue, no staining, no condensation?", "required" => true},
      %{"id" => "dry", "type" => "yes_no", "label" => "Surfaces DRY (no puddling, no wet spots)?", "required" => true},
      %{"id" => "verification",
        "type" => "dropdown",
        "label" => "Verification performed",
        "required" => true,
        "options" => [
          %{"id" => "swab_taken", "label" => "QC swab taken"},
          %{"id" => "rinse_taken", "label" => "Final-rinse sample sent to QC"},
          %{"id" => "visual_only", "label" => "Visual only (per SOP for this protocol)"}
        ]},
      %{"id" => "sample_id",
        "type" => "text",
        "label" => "QC sample ID (fill when swab / rinse taken)",
        "required" => false,
        "placeholder" => "SWAB-… / RIN-…"},
      %{"id" => "conductivity_us", "type" => "number", "label" => "Final rinse conductivity (µS/cm) — enter 0 if not measured", "required" => true, "placeholder" => "target ≤ 10"},
      %{"id" => "sop_followed", "type" => "yes_no", "label" => "SOP-CLEAN-006 followed step-by-step?", "required" => true},
      %{"id" => "deviations", "type" => "text", "label" => "Deviations / comments (write NONE if the clean was routine)", "required" => true, "placeholder" => "NONE"},
      %{"id" => "outcome", "type" => "rating", "label" => "Cleaning outcome (1 poor → 5 spotless)", "required" => true, "max_rating" => 5},
      %{"id" => "ack_tag_clean", "type" => "acknowledgement", "label" => "Cell tagged CLEANED, paper log signed, ready for next production", "required" => true}
    ]),
  "maintenance_start" =>
    wrap_schema.([
      %{"id" => "ack_loto_maint", "type" => "acknowledgement", "label" => "LOTO applied per SOP-MAINT-014, my padlock + tag on the isolator", "required" => true},
      %{"id" => "cooled", "type" => "yes_no", "label" => "Machine cooled to ambient?", "required" => true},
      %{"id" => "pressure_bled", "type" => "yes_no", "label" => "Residual pressure / stored energy bled and verified zero?", "required" => true},
      %{"id" => "work_order", "type" => "text", "label" => "Work order / ticket number", "required" => true, "placeholder" => "WO-2026-…"},
      %{"id" => "service_type",
        "type" => "dropdown",
        "label" => "Maintenance type",
        "required" => true,
        "options" => [
          %{"id" => "preventive", "label" => "Preventive (scheduled)"},
          %{"id" => "corrective", "label" => "Corrective (fault fix)"},
          %{"id" => "calibration", "label" => "Calibration only"},
          %{"id" => "inspection", "label" => "Inspection only (no parts change)"}
        ]},
      %{"id" => "planned_tasks", "type" => "text", "label" => "Tasks planned this session (one per line)", "required" => true, "placeholder" => "e.g. replace lower bearing\\ncheck drive belt tension"},
      %{"id" => "instr_calibrated", "type" => "yes_no", "label" => "Torque wrench + calibrated instruments in-date?", "required" => true},
      %{"id" => "spares_staged", "type" => "yes_no", "label" => "Spare parts + consumables staged at the cell?", "required" => true}
    ]),
  "maintenance_end" =>
    wrap_schema.([
      %{"id" => "ack_loto_off", "type" => "acknowledgement", "label" => "LOTO removed, my padlock returned to the lock station", "required" => true},
      %{"id" => "fasteners_torqued", "type" => "yes_no", "label" => "All fasteners torqued to spec?", "required" => true},
      %{"id" => "guards_verified", "type" => "yes_no", "label" => "Guards refitted + interlocks tested + E-stop verified?", "required" => true},
      %{"id" => "parts_replaced", "type" => "text", "label" => "Parts replaced (one per line, include mfr part # if traceable)", "required" => true, "placeholder" => "NONE  /  DBT-450 drive belt"},
      %{"id" => "downtime_min", "type" => "number", "label" => "Total downtime (minutes)", "required" => true},
      %{"id" => "test_run_min", "type" => "number", "label" => "Post-service test-run duration (min)", "required" => true},
      %{"id" => "health", "type" => "rating", "label" => "Machine health after service (1 concerning → 5 excellent)", "required" => true, "max_rating" => 5},
      %{"id" => "followups", "type" => "text", "label" => "Follow-up recommendations for next service (write NONE if all-clear)", "required" => true, "placeholder" => "NONE"},
      %{"id" => "ack_handback", "type" => "acknowledgement", "label" => "Machine handed back to production, ready to run", "required" => true}
    ]),
  "equipment_cleaning_start" =>
    wrap_schema.([
      %{"id" => "ack_isolated_eq", "type" => "acknowledgement", "label" => "Machine isolated + locked-out per SOP-CIP-002", "required" => true},
      %{"id" => "residue_removed_eq", "type" => "yes_no", "label" => "Batch residue removed by dry method (scrape / vacuum) first?", "required" => true},
      %{"id" => "ports_blanked", "type" => "yes_no", "label" => "Feed + discharge ports blanked / valves closed?", "required" => true},
      %{"id" => "spray_ball_ok", "type" => "yes_no", "label" => "CIP hose connected to the correct spray-ball / diffuser?", "required" => true},
      %{"id" => "cip_cycle",
        "type" => "dropdown",
        "label" => "CIP cycle to run",
        "required" => true,
        "options" => [
          %{"id" => "rinse_only", "label" => "Water rinse only (5 min)"},
          %{"id" => "short", "label" => "Short cycle · rinse+detergent+rinse (20 min)"},
          %{"id" => "full", "label" => "Full CIP · rinse+detergent+rinse+sanitizer+rinse (45 min)"},
          %{"id" => "cip_sip", "label" => "Full CIP + SIP steam sanitization (90 min)"}
        ]},
      %{"id" => "solution_pct", "type" => "number", "label" => "Detergent concentration (%)", "required" => true, "placeholder" => "e.g. 2.0"},
      %{"id" => "water_temp", "type" => "number", "label" => "Rinse water temperature at start (°C)", "required" => true, "placeholder" => "e.g. 65"},
      %{"id" => "agent_lot_eq", "type" => "text", "label" => "CIP agent lot number", "required" => true, "placeholder" => "e.g. CIP-LOT-2026-08-14"}
    ]),
  "equipment_cleaning_end" =>
    wrap_schema.([
      %{"id" => "ack_dry", "type" => "acknowledgement", "label" => "CIP cycle completed, drained, air-blown dry", "required" => true},
      %{"id" => "final_conductivity", "type" => "number", "label" => "Final rinse conductivity (µS/cm)", "required" => true, "placeholder" => "target ≤ 10"},
      %{"id" => "final_ph", "type" => "number", "label" => "Final rinse pH (7 = neutral)", "required" => true, "placeholder" => "e.g. 7.2"},
      %{"id" => "visual_ok_eq", "type" => "yes_no", "label" => "Visual inspection through hatch / borescope passed?", "required" => true},
      %{"id" => "toc_taken", "type" => "yes_no", "label" => "TOC swab taken from previous-batch contact surface?", "required" => true},
      %{"id" => "toc_result",
        "type" => "text",
        "label" => "TOC result (ppm)",
        "required" => false,
        "placeholder" => "e.g. 0.5",
        "condition" => %{"field_id" => "toc_taken", "operator" => "equals", "value" => "yes"}},
      %{"id" => "endotoxin_taken", "type" => "yes_no", "label" => "Endotoxin swab taken (for parenteral-adjacent equipment)?", "required" => true},
      %{"id" => "endotoxin_result",
        "type" => "text",
        "label" => "Endotoxin result (EU/mL)",
        "required" => false,
        "placeholder" => "e.g. < 0.25",
        "condition" => %{"field_id" => "endotoxin_taken", "operator" => "equals", "value" => "yes"}},
      %{"id" => "cip_quality", "type" => "rating", "label" => "CIP effectiveness (1 fail → 5 excellent)", "required" => true, "max_rating" => 5},
      %{"id" => "ack_disconnect", "type" => "acknowledgement", "label" => "Machine disconnected from CIP loop, tagged CLEAN, ready for next batch", "required" => true}
    ]),
  "equipment_maintenance_start" =>
    wrap_schema.([
      %{"id" => "ack_loto_eq_sop", "type" => "acknowledgement", "label" => "Machine-specific LOTO applied per SOP-MAINT-014", "required" => true},
      %{"id" => "manual_available", "type" => "yes_no", "label" => "Service manual + electrical drawings on hand?", "required" => true},
      %{"id" => "torque_cal", "type" => "yes_no", "label" => "Torque wrench calibration in-date (< 12 months)?", "required" => true},
      %{"id" => "interval",
        "type" => "dropdown",
        "label" => "Service interval",
        "required" => true,
        "options" => [
          %{"id" => "500h", "label" => "500-hour (light PM)"},
          %{"id" => "1000h", "label" => "1,000-hour (bearings + belt inspection)"},
          %{"id" => "2000h", "label" => "2,000-hour (major overhaul)"},
          %{"id" => "condition", "label" => "Condition-based / unscheduled"}
        ]},
      %{"id" => "vibration_before", "type" => "number", "label" => "Vibration BEFORE service (mm/s RMS)", "required" => true, "placeholder" => "e.g. 2.8"},
      %{"id" => "bearing_temp_before", "type" => "number", "label" => "Bearing housing temperature BEFORE (°C)", "required" => true, "placeholder" => "e.g. 55"},
      %{"id" => "planned_parts", "type" => "text", "label" => "Anticipated parts to replace (one per line)", "required" => true, "placeholder" => "e.g. lower bearing kit\\ndrive belt (DBT-450)"}
    ]),
  "equipment_maintenance_end" =>
    wrap_schema.([
      %{"id" => "ack_reassembled", "type" => "acknowledgement", "label" => "Machine reassembled per SOP, all fasteners torqued to spec", "required" => true},
      %{"id" => "parts_replaced_eq", "type" => "text", "label" => "Parts actually replaced (comma-separated)", "required" => true, "placeholder" => "NONE  /  lower bearing, drive belt"},
      %{"id" => "parts_serials", "type" => "text", "label" => "Serial / batch numbers of replaced parts (for traceability)", "required" => false, "placeholder" => "e.g. BRG-9821, DBT-2026-Q3-042"},
      %{"id" => "vibration_after", "type" => "number", "label" => "Vibration AFTER service (mm/s RMS)", "required" => true, "placeholder" => "target < 1.5"},
      %{"id" => "bearing_temp_after", "type" => "number", "label" => "Bearing housing temp AFTER test-run (°C)", "required" => true, "placeholder" => "target < 60"},
      %{"id" => "test_run_ok", "type" => "yes_no", "label" => "Test run at normal speed clean (no unusual noise, no leaks)?", "required" => true},
      %{"id" => "guards_verified_eq", "type" => "yes_no", "label" => "Guards refitted + interlocks + E-stop verified?", "required" => true},
      %{"id" => "logbook_notes", "type" => "text", "label" => "Notes for the machine logbook (write NONE if routine)", "required" => true, "placeholder" => "NONE"},
      %{"id" => "ack_returned_eq", "type" => "acknowledgement", "label" => "Machine returned to service, LOTO removed", "required" => true}
    ])
}

template_specs = [
  # Production-session hooks — fire when an operator starts / stops
  # a workstation session (jobs tab flow, no cleaning involved).
  {"Job start · Blending", "workstation_start"},
  {"Job end · Blending", "workstation_end"},
  # Cleaning + maintenance session hooks — two phases each.
  {"Cleaning start · Blending", "cleaning_start"},
  {"Cleaning end · Blending", "cleaning_end"},
  {"Maintenance start · Blending", "maintenance_start"},
  {"Maintenance end · Blending", "maintenance_end"},
  {"CIP start · V-blender", "equipment_cleaning_start"},
  {"CIP end · V-blender", "equipment_cleaning_end"},
  {"Service start · V-blender", "equipment_maintenance_start"},
  {"Service end · V-blender", "equipment_maintenance_end"}
]

templates =
  Enum.map(template_specs, fn {name, trigger} ->
    schema = Map.fetch!(schemas, trigger)

    case Repo.get_by(FormTemplate, company_id: company.id, name: name) do
      nil ->
        {:ok, tpl} =
          %FormTemplate{}
          |> FormTemplate.changeset(%{
            "company_id" => company.id,
            "name" => name,
            "trigger" => trigger,
            "schema" => schema,
            "is_active" => true,
            "created_by_id" => actor.id,
            "updated_by_id" => actor.id
          })
          |> Repo.insert()

        IO.puts("Created template: #{tpl.name} (#{tpl.trigger}) · #{length(schema["fields"])} fields")
        {trigger, tpl}

      existing ->
        # Rewrite schema + bump version so vp accepts the update
        # (publish endpoint drops schema on stale psp_version).
        {:ok, tpl} =
          existing
          |> FormTemplate.changeset(%{
            "schema" => schema,
            "version" => (existing.version || 1) + 1,
            "updated_by_id" => actor.id
          })
          |> Repo.update()

        IO.puts("Updated template: #{tpl.name} (#{tpl.trigger}) · v#{tpl.version} · #{length(schema["fields"])} fields")
        {trigger, tpl}
    end
  end)
  |> Map.new()

# ── Workstation form assignments ───────────────────────────────────

ws_slots = [
  "workstation_start",
  "workstation_end",
  "cleaning_start",
  "cleaning_end",
  "maintenance_start",
  "maintenance_end"
]

Enum.each(ws_slots, fn slot ->
  tpl = Map.fetch!(templates, slot)

  case Repo.one(
         from a in WorkstationFormAssignment,
           where:
             a.workstation_id == ^ws.id and
               a.form_template_id == ^tpl.id and
               a.slot == ^slot,
           limit: 1
       ) do
    nil ->
      {:ok, _} =
        %WorkstationFormAssignment{}
        |> WorkstationFormAssignment.changeset(%{
          "workstation_id" => ws.id,
          "form_template_id" => tpl.id,
          "slot" => slot,
          "sort_order" => 0
        })
        |> Repo.insert()

      IO.puts("Attached to #{ws.name}: #{slot} → #{tpl.name}")

    _existing ->
      IO.puts("Already attached to #{ws.name}: #{slot}")
  end
end)

# ── Category form assignments ──────────────────────────────────────

cat_slots = [
  "equipment_cleaning_start",
  "equipment_cleaning_end",
  "equipment_maintenance_start",
  "equipment_maintenance_end"
]

Enum.each(cat_slots, fn slot ->
  tpl = Map.fetch!(templates, slot)

  case Repo.one(
         from a in CategoryFormAssignment,
           where:
             a.equipment_category_id == ^category.id and
               a.form_template_id == ^tpl.id and
               a.slot == ^slot,
           limit: 1
       ) do
    nil ->
      {:ok, _} =
        %CategoryFormAssignment{}
        |> CategoryFormAssignment.changeset(%{
          "company_id" => company.id,
          "equipment_category_id" => category.id,
          "form_template_id" => tpl.id,
          "slot" => slot,
          "sort_order" => 0
        })
        |> Repo.insert()

      IO.puts("Attached to #{category.name}: #{slot} → #{tpl.name}")

    _existing ->
      IO.puts("Already attached to #{category.name}: #{slot}")
  end
end)

# ── Publish everything → vp mirror ─────────────────────────────────
# Both publishers fire from the CRUD paths above, but they run
# async through Task.Supervisor. Do one final SYNC publish so the
# script exits after vp has actually received the payloads — makes
# testing straightforward (no "wait a beat" surprise).

IO.puts("\nRepublishing to vita-perf (sync)…")

case Backend.Forms.Publisher.publish_workstation_sync(ws) do
  :ok ->
    IO.puts("Forms publish → vp: OK")

  :not_configured ->
    IO.puts("Forms publish → vp: skipped (PSP_TO_VITAPERF_URL/TOKEN unset).")
    IO.puts("  Set them + rerun, or restart the Phoenix server after this script — the ")
    IO.puts("  reconciler sweep on the next boot will re-fire pending publishes.")

  other ->
    IO.puts("Forms publish → vp: #{inspect(other)}")
end

case Backend.Production.WorkstationEquipmentPublisher.publish_workstation(ws) do
  :ok -> IO.puts("Equipment sync → vp: OK")
  :not_configured -> IO.puts("Equipment sync → vp: skipped (env vars unset).")
  other -> IO.puts("Equipment sync → vp: #{inspect(other)}")
end

# ── Attempt an in-progress MO on Blending #1 ───────────────────────

group_id = ws.workstation_group_id

if is_nil(group_id) do
  IO.puts("\nSkipping MO seed: #{ws.name} has no workstation_group_id.")
else
  # MOs target a producible item — finished_product or semi_finished.
  # Pick the newest finished_product; fall back to semi_finished if
  # none exist so the seed works on a fresh tenant.
  output_item =
    Repo.one(
      from i in Item,
        where: i.item_type in ["finished_product", "semi_finished"] and i.is_active == true,
        order_by: [desc: i.item_type == "finished_product", desc: i.id],
        limit: 1
    )

  cond do
    is_nil(output_item) ->
      IO.puts("\nSkipping MO seed: no finished_product / semi_finished items exist to key off.")

    true ->
      warehouse_id =
        Repo.one(
          from w in Backend.Warehouses.Warehouse,
            where: w.company_id == ^company.id,
            order_by: w.id,
            limit: 1,
            select: w.id
        )

      bom_id =
        Repo.one(
          from b in Backend.Production.BOM,
            where: b.item_id == ^output_item.id,
            order_by: [desc: b.id],
            limit: 1,
            select: b.id
        )

      routing_id =
        Repo.one(
          from r in Backend.Production.Routing,
            where: r.item_id == ^output_item.id,
            order_by: [desc: r.id],
            limit: 1,
            select: r.id
        )

      case Repo.one(
             from m in ManufacturingOrder,
               where:
                 m.company_id == ^company.id and
                   m.item_id == ^output_item.id and
                   m.status == "in_progress"
           ) do
        nil when is_nil(bom_id) or is_nil(routing_id) ->
          IO.puts("\nSkipping MO seed: no BOM (#{inspect(bom_id)}) or routing (#{inspect(routing_id)}) exists for item #{output_item.name}.")
          IO.puts("  Create one via /production/boms/new + /production/routings/new, then rerun.")

        nil ->
          # Bare-metal insert bypassing the full CO/BOM/routing
          # cascade — this is a dev seed, we don't need bookings or
          # audit for a test MO.
          try do
            now = DateTime.utc_now() |> DateTime.truncate(:second)

            {:ok, mo} =
              Repo.insert(%ManufacturingOrder{
                uuid: Ecto.UUID.generate(),
                company_id: company.id,
                item_id: output_item.id,
                bom_id: bom_id,
                routing_id: routing_id,
                warehouse_id: warehouse_id,
                assigned_to_id: actor.id,
                quantity: Decimal.new("10"),
                status: "in_progress",
                project_type: "production",
                created_by_id: actor.id,
                updated_by_id: actor.id,
                inserted_at: now,
                updated_at: now
              })

            {:ok, _step} =
              Repo.insert(%ManufacturingOrderStep{
                uuid: Ecto.UUID.generate(),
                company_id: company.id,
                manufacturing_order_id: mo.id,
                workstation_group_id: group_id,
                operation_description: "Test cleaning-and-maintenance job on #{ws.name}",
                sort_order: 0,
                created_by_id: actor.id,
                updated_by_id: actor.id,
                inserted_at: now,
                updated_at: now
              })

            IO.puts("\nSeeded MO: uuid=#{mo.uuid}, status=in_progress, item=#{output_item.name}")
            IO.puts("  Kiosk Jobs tab should show it on #{ws.name}.")
          rescue
            e ->
              IO.puts("\nCouldn't seed MO — insert refused by DB (#{Exception.message(e)}).")
              IO.puts("Create one via the PSP UI instead: /production/manufacturing-orders/new")
          end

        existing ->
          IO.puts("\nReusing existing in_progress MO: uuid=#{existing.uuid}")
      end
  end
end

IO.puts("\nSeed complete. Reload the kiosk to see the new forms + machines.")
