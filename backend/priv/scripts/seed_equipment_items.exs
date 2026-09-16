# Seeds a realistic supplement-manufacturer equipment-item catalog.
# Idempotent — skips names that already exist for the company. Run with:
#
#   mix run priv/scripts/seed_equipment_items.exs
#
# The rows land as `item_type = "equipment"` and `compliance_status =
# "draft"` (default). Equipment items don't flow through the stock-lot
# pipeline, so draft is a fine terminal state — they just show up in
# the /equipment/new picker.

alias Backend.Repo
alias Backend.Items.Item

company_id = 1
actor_id = 1

# One row per equipment item. `sku` becomes external_sku so the
# picker can show a code alongside the name; `desc` is the item
# description shown on the item detail page.
rows = [
  # ── Production — capsule / tablet / powder lines ───────────────
  %{sku: "EQ-CAP-100", name: "Automatic capsule filling machine", desc: "High-speed encapsulator for 000–5 shell sizes; 100,000 caps/hr class."},
  %{sku: "EQ-CAP-60", name: "Semi-automatic capsule filler", desc: "Bench-top encapsulator for pilot / low-volume batches."},
  %{sku: "EQ-TAB-COMP", name: "Rotary tablet press", desc: "Multi-station tablet compression machine for direct-compression and granulation feed."},
  %{sku: "EQ-TAB-COAT", name: "Tablet coating pan", desc: "Perforated coating pan for film/enteric coating of tablets."},
  %{sku: "EQ-BLIS-1", name: "Blister packaging machine", desc: "Thermoform blister packer for tablets & capsules (PVC/Alu, Alu/Alu)."},
  %{sku: "EQ-DBLIS", name: "Deblistering machine", desc: "Recovers tablets/capsules from failed blister packs."},
  %{sku: "EQ-VMIX-500", name: "V-blender 500 L", desc: "Twin-shell V-blender for dry powder homogenisation."},
  %{sku: "EQ-VMIX-100", name: "V-blender 100 L", desc: "Bench V-blender for pilot batches and small runs."},
  %{sku: "EQ-RMIX-800", name: "Ribbon mixer 800 L", desc: "Horizontal ribbon blender for larger powder / granule batches."},
  %{sku: "EQ-BINBLEND", name: "Bin blender IBC 300 L", desc: "IBC tumbling blender for cross-contamination-controlled blends."},
  %{sku: "EQ-GRAN-FBG", name: "Fluid-bed granulator/dryer", desc: "Combined wet granulation and drying unit."},
  %{sku: "EQ-GRAN-HS", name: "High-shear granulator", desc: "Top-drive high-shear wet granulator, 75 L bowl."},
  %{sku: "EQ-MILL-CO", name: "Comil milling machine", desc: "Conical screen mill for granule sizing and de-lumping."},
  %{sku: "EQ-MILL-HM", name: "Hammer mill", desc: "Coarse-to-fine hammer mill for raw material size reduction."},
  %{sku: "EQ-SIEVE-1", name: "Vibratory sieve separator", desc: "Multi-deck vibratory screener for powder sieving/classification."},
  %{sku: "EQ-HOMOG-1", name: "Homogeniser (rotor-stator)", desc: "Inline rotor-stator homogeniser for suspensions/emulsions."},
  %{sku: "EQ-COOK-1", name: "Jacketed process cooker 500 L", desc: "Steam-jacketed vessel with agitator for gummy/liquid pre-mixes."},
  %{sku: "EQ-GUMMY-1", name: "Gummy depositor", desc: "Servo depositor for gummy/pastille moulds."},
  %{sku: "EQ-GUMMY-TUN", name: "Gummy cooling tunnel", desc: "Refrigerated tunnel matched to the gummy depositor."},

  # ── Bottling / packaging lines ─────────────────────────────────
  %{sku: "EQ-BTL-UNSCR", name: "Bottle unscrambler", desc: "Rotary unscrambler feeding bottles to the filler."},
  %{sku: "EQ-BTL-COUNT", name: "Slat-counter tablet filler", desc: "Slat-counter counting filler for tablets/capsules into bottles."},
  %{sku: "EQ-BTL-CAP", name: "Bottle capping machine", desc: "Chuck/spindle capper for CRC and non-CRC closures."},
  %{sku: "EQ-BTL-SEAL", name: "Induction sealer", desc: "Continuous induction cap sealer with reject station."},
  %{sku: "EQ-LBL-1", name: "Wrap-around labeller", desc: "Pressure-sensitive labeller for cylindrical bottles."},
  %{sku: "EQ-LBL-2", name: "Front-and-back labeller", desc: "Two-station labeller for shaped bottles."},
  %{sku: "EQ-CART-1", name: "Cartoning machine", desc: "Horizontal cartoner for finished-goods secondary packaging."},
  %{sku: "EQ-CASE-1", name: "Case packer", desc: "Semi-automatic case packer for corrugated shippers."},
  %{sku: "EQ-CODE-INK", name: "Inkjet coder", desc: "Continuous-inkjet coder for batch/expiry printing on primary packs."},
  %{sku: "EQ-CODE-LASER", name: "Laser coder", desc: "CO2 laser coder for date/lot marking on carton and bottle."},
  %{sku: "EQ-CONV-1", name: "Modular belt conveyor", desc: "Reconfigurable modular belt conveyor section."},

  # ── Automation / in-line QC ─────────────────────────────────────
  %{sku: "EQ-MD-1", name: "Metal detector", desc: "Gravity-fed metal detector with reject flap for powders/tablets."},
  %{sku: "EQ-CW-1", name: "Checkweigher", desc: "Dynamic in-line checkweigher with reject arm."},
  %{sku: "EQ-VIS-1", name: "Vision inspection system", desc: "Camera-based inspection for label placement and cap presence."},

  # ── Filling & liquid dosing ─────────────────────────────────────
  %{sku: "EQ-LIQ-FILL", name: "Liquid volumetric filler", desc: "Servo piston filler for tinctures / liquid supplements."},
  %{sku: "EQ-PUMP-PERI", name: "Peristaltic dosing pump", desc: "Sanitary peristaltic pump for viscous / particulate transfer."},
  %{sku: "EQ-PUMP-LOBE", name: "Lobe pump (sanitary)", desc: "Rotary lobe pump for viscous liquid transfer."},
  %{sku: "EQ-TANK-500", name: "Sanitary process tank 500 L", desc: "Jacketed stainless tank with top-mount agitator."},

  # ── QC / lab bench ─────────────────────────────────────────────
  %{sku: "EQ-BAL-ANAL", name: "Analytical balance", desc: "0.1 mg resolution analytical balance for release testing."},
  %{sku: "EQ-BAL-PREC", name: "Precision balance", desc: "1 mg resolution top-loader precision balance."},
  %{sku: "EQ-BAL-FLOOR", name: "Floor platform scale 600 kg", desc: "Warehouse floor scale for pallet / IBC weighing."},
  %{sku: "EQ-PH-1", name: "pH / conductivity meter", desc: "Bench pH meter with temperature-compensated probe."},
  %{sku: "EQ-MOIST-1", name: "Halogen moisture analyzer", desc: "Loss-on-drying moisture balance for powders / granules."},
  %{sku: "EQ-HARD-1", name: "Tablet hardness tester", desc: "Motorised hardness tester with force / diameter / thickness readouts."},
  %{sku: "EQ-DIS-1", name: "Disintegration tester", desc: "Six-basket disintegration bath, USP-compliant."},
  %{sku: "EQ-DISS-1", name: "Dissolution tester", desc: "Eight-position dissolution bath (Apparatus 1 & 2)."},
  %{sku: "EQ-FRIA-1", name: "Friability tester", desc: "Dual-drum friability tester, USP-compliant."},
  %{sku: "EQ-DENS-1", name: "Tapped density tester", desc: "Bulk / tapped density apparatus for powders."},
  %{sku: "EQ-VISC-1", name: "Rotational viscometer", desc: "Spindle-type rotational viscometer for liquid QC."},
  %{sku: "EQ-REFR-1", name: "Digital refractometer", desc: "Benchtop refractometer (°Brix / RI) for liquid QC."},
  %{sku: "EQ-KF-1", name: "Karl Fischer titrator", desc: "Volumetric Karl Fischer titrator for water determination."},
  %{sku: "EQ-TITR-1", name: "Automatic potentiometric titrator", desc: "Multi-parameter potentiometric titrator."},
  %{sku: "EQ-HPLC-1", name: "HPLC system", desc: "Isocratic/gradient HPLC with UV/PDA detector for actives assay."},
  %{sku: "EQ-UV-1", name: "UV-Vis spectrophotometer", desc: "Double-beam UV-Vis for content-uniformity / colour tests."},
  %{sku: "EQ-MICRO-1", name: "Laboratory microscope", desc: "Compound microscope for microbiological / particulate checks."},
  %{sku: "EQ-INCU-1", name: "Microbiology incubator", desc: "Convection incubator for micro plate incubation."},
  %{sku: "EQ-AUTO-1", name: "Autoclave (bench)", desc: "Vertical benchtop autoclave for lab-ware sterilisation."},
  %{sku: "EQ-WATER-1", name: "Water bath (thermostatic)", desc: "Circulating water bath, ambient +5 → 100 °C."},
  %{sku: "EQ-ROTA-1", name: "Rotary evaporator", desc: "Vacuum rotary evaporator with chiller."},
  %{sku: "EQ-FUME-1", name: "Fume cupboard", desc: "Ducted fume hood for solvent / acid handling."},
  %{sku: "EQ-LAF-1", name: "Laminar flow cabinet", desc: "Class II biological safety cabinet for aseptic sampling."},

  # ── Warehouse / material handling ──────────────────────────────
  %{sku: "EQ-FL-EL", name: "Electric counterbalance forklift", desc: "Sit-on 1.6 t electric forklift, indoor use."},
  %{sku: "EQ-FL-REACH", name: "Reach truck (electric)", desc: "Narrow-aisle reach truck for high-bay racking."},
  %{sku: "EQ-PJ-MAN", name: "Manual pallet truck", desc: "2.5 t hand pallet truck."},
  %{sku: "EQ-PJ-EL", name: "Powered pallet truck", desc: "Walkie powered pallet truck, 1.6 t."},
  %{sku: "EQ-STRWR", name: "Stretch wrap machine", desc: "Turntable stretch-wrap machine for pallet loads."},
  %{sku: "EQ-SHRINK", name: "Shrink tunnel", desc: "Heat-shrink tunnel for multipacks."},
  %{sku: "EQ-DRUM-TL", name: "Drum tilter/rotator", desc: "Powered drum tilter for material discharge."},
  %{sku: "EQ-BIN-LIFT", name: "Bin/tote lifter", desc: "Column-lift/tilter for stainless IBCs into blenders."},
  %{sku: "EQ-SACK-TIP", name: "Sack tipping station", desc: "Contained sack tipper with dust extraction."},
  %{sku: "EQ-BAG-DUMP", name: "Bulk bag unloader", desc: "FIBC unloader with hoist and massaging paddles."},

  # ── Utilities / cleaning ───────────────────────────────────────
  %{sku: "EQ-COMP-1", name: "Air compressor (oil-free)", desc: "Rotary-screw oil-free compressor, sized for the production hall."},
  %{sku: "EQ-DRY-1", name: "Refrigerated air dryer", desc: "Refrigerated dryer downstream of the compressor."},
  %{sku: "EQ-CHILL-1", name: "Process chiller", desc: "Air-cooled water chiller for jacketed vessels."},
  %{sku: "EQ-DUST-1", name: "Dust extraction unit", desc: "Central dust collector for powder-handling stations."},
  %{sku: "EQ-VAC-HEPA", name: "HEPA industrial vacuum", desc: "ATEX-rated HEPA vacuum for GMP room cleaning."},
  %{sku: "EQ-STEAM-1", name: "Steam cleaner", desc: "Portable steam cleaner for equipment sanitisation."},
  %{sku: "EQ-JET-1", name: "Pressure washer", desc: "Hot-water pressure washer for external cleaning."},
  %{sku: "EQ-RO-1", name: "Reverse-osmosis water unit", desc: "RO water plant feeding formulation and cleaning loops."},

  # ── Environmental / monitoring ─────────────────────────────────
  %{sku: "EQ-DL-TEMP", name: "Temperature/humidity data logger", desc: "USB data logger for warehouse T/RH monitoring."},
  %{sku: "EQ-SENS-COLD", name: "Cold-room sensor probe", desc: "Wireless temperature probe for cold rooms/fridges."},
  %{sku: "EQ-CO2-1", name: "CO2 / air-quality monitor", desc: "Fixed indoor air-quality monitor."},

  # ── IT / office ────────────────────────────────────────────────
  %{sku: "EQ-LT-DEV", name: "Developer laptop", desc: "High-spec laptop assigned to engineering / IT."},
  %{sku: "EQ-LT-OFF", name: "Office laptop", desc: "Standard business laptop for office staff."},
  %{sku: "EQ-DT-OFF", name: "Office desktop PC", desc: "Fixed desktop for accounting / reception."},
  %{sku: "EQ-MON-27", name: "27\" office monitor", desc: "QHD 27-inch monitor."},
  %{sku: "EQ-TV-55", name: "55\" information display", desc: "Wall-mounted display for KPI / production boards."},
  %{sku: "EQ-DOCK-1", name: "USB-C laptop docking station", desc: "Multi-port dock for hot-desks."},
  %{sku: "EQ-KVM-1", name: "KVM switch", desc: "Multi-computer keyboard/mouse switch for the server bench."},
  %{sku: "EQ-PRT-LBL", name: "Zebra label printer", desc: "Thermal-transfer label printer for stock/pallet labels."},
  %{sku: "EQ-PRT-A4", name: "A4 laser printer", desc: "Colour laser multifunction printer."},
  %{sku: "EQ-SCAN-HHT", name: "Handheld barcode scanner", desc: "Wired 2D imager for stock movements at fixed stations."},
  %{sku: "EQ-SCAN-WL", name: "Wireless barcode scanner", desc: "Bluetooth 2D scanner for warehouse work."},
  %{sku: "EQ-TAB-WHS", name: "Zebra warehouse tablet", desc: "Rugged Android tablet for PSP mobile flows."},
  %{sku: "EQ-RAD-1", name: "Two-way radio", desc: "PMR/UHF handheld radio for warehouse comms."},
  %{sku: "EQ-ROUTER-1", name: "Warehouse Wi-Fi access point", desc: "Ceiling-mount enterprise Wi-Fi 6 AP."},
  %{sku: "EQ-UPS-1", name: "Server-room UPS", desc: "Rack-mount UPS for on-prem server / network cabinet."}
]

now = DateTime.utc_now() |> DateTime.truncate(:second)

{inserted, skipped, failed} =
  Enum.reduce(rows, {0, 0, []}, fn row, {ins, skip, fail} ->
    attrs = %{
      "company_id" => company_id,
      "name" => row.name,
      "description" => row.desc,
      "item_type" => "equipment",
      "external_sku" => row.sku,
      "compliance_status" => "draft",
      "is_active" => true,
      "created_by_id" => actor_id,
      "updated_by_id" => actor_id
    }

    cs = Item.changeset(%Item{}, attrs)

    case Repo.insert(cs) do
      {:ok, _item} ->
        {ins + 1, skip, fail}

      {:error, %Ecto.Changeset{errors: errs}} ->
        # Uniqueness errors on name or external_sku are treated as
        # idempotent skips — the row already exists.
        if Enum.any?(errs, fn {field, {_msg, _}} ->
             field in [:name, :external_sku]
           end) do
          {ins, skip + 1, fail}
        else
          {ins, skip, [{row.name, errs} | fail]}
        end
    end
  end)

IO.puts("")
IO.puts("Equipment-item seed complete:")
IO.puts("  inserted: #{inserted}")
IO.puts("  skipped (already existed): #{skipped}")

if failed != [] do
  IO.puts("  FAILED (#{length(failed)}):")

  for {name, errs} <- failed do
    IO.puts("    - #{name}: #{inspect(errs)}")
  end
end

_ = now
