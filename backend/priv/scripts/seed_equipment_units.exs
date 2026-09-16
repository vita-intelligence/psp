# Seeds realistic equipment categories + units for demo / dev.
# Idempotent — categories keyed by name, units keyed by
# (company_id, serial_number) via the DB unique index.
#
# Categories carry defaults (useful_life_years / calibration /
# maintenance frequencies) so new units created against them
# auto-populate cadences. Seeded units set explicit cadences too so
# the /equipment ledger surfaces realistic "next due" chips.
#
# Run with:
#   MIX_ENV=dev mix run priv/scripts/seed_equipment_units.exs

import Ecto.Query

alias Backend.Repo
alias Backend.Equipment
alias Backend.Equipment.Categories

company_id = 1
actor = Backend.Accounts.User |> Repo.get!(1)

now = DateTime.utc_now() |> DateTime.truncate(:second)

# ── 1. Categories ─────────────────────────────────────────────────

categories_spec = [
  %{
    name: "Lab & QC instruments",
    notes: "Analytical instruments requiring periodic calibration under BRCGS / FSSC.",
    useful_life_years: 10,
    calibration_months: 12,
    maintenance_months: 12
  },
  %{
    name: "Weighing equipment",
    notes: "Balances, scales — annual calibration + servicing.",
    useful_life_years: 12,
    calibration_months: 12,
    maintenance_months: 12
  },
  %{
    name: "Filling & packaging",
    notes: "Line kit downstream of the mixers — capping, sealing, labelling, coding.",
    useful_life_years: 12,
    calibration_months: nil,
    maintenance_months: 6
  },
  %{
    name: "Mixing & granulation",
    notes: "Powder / gummy prep — blenders, granulators, mills, sieves.",
    useful_life_years: 15,
    calibration_months: nil,
    maintenance_months: 6
  },
  %{
    name: "Automation & inspection",
    notes: "In-line reject stations — metal detector, checkweigher, vision.",
    useful_life_years: 10,
    calibration_months: 6,
    maintenance_months: 6
  },
  %{
    name: "Material handling",
    notes: "Forklifts, pallet trucks, stretch wrap, drum tilters.",
    useful_life_years: 8,
    calibration_months: nil,
    maintenance_months: 12
  },
  %{
    name: "Utilities",
    notes: "Compressors, dryers, chillers, dust extraction, RO water.",
    useful_life_years: 15,
    calibration_months: nil,
    maintenance_months: 12
  },
  %{
    name: "Cleaning equipment",
    notes: "Steam cleaners, pressure washers, HEPA vacuums.",
    useful_life_years: 5,
    calibration_months: nil,
    maintenance_months: 12
  },
  %{
    name: "Environmental sensors",
    notes: "Data loggers + probes for warehouse / cold-room T&RH monitoring.",
    useful_life_years: 5,
    calibration_months: 12,
    maintenance_months: nil
  },
  %{
    name: "IT hardware",
    notes: "Laptops, desktops, monitors, docks, printers, scanners.",
    useful_life_years: 4,
    calibration_months: nil,
    maintenance_months: nil
  },
  %{
    name: "Network & AV",
    notes: "Wi-Fi APs, information displays, radios, UPS.",
    useful_life_years: 6,
    calibration_months: nil,
    maintenance_months: nil
  }
]

IO.puts("Seeding equipment categories…")

category_by_name =
  Enum.reduce(categories_spec, %{}, fn spec, acc ->
    attrs = %{
      "name" => spec.name,
      "notes" => spec.notes,
      "default_useful_life_years" => spec.useful_life_years,
      "default_calibration_frequency_months" => spec.calibration_months,
      "default_maintenance_frequency_months" => spec.maintenance_months,
      "is_active" => true
    }

    case Categories.create(company_id, attrs, actor) do
      {:ok, cat} ->
        IO.puts("  + #{cat.name}")
        Map.put(acc, cat.name, cat)

      {:error, %Ecto.Changeset{errors: errs}} ->
        # Uniqueness on (company_id, name) → treat as idempotent.
        if Enum.any?(errs, fn {f, _} -> f == :name end) do
          existing = Categories.list_for_company(company_id)
                     |> Enum.find(&(&1.name == spec.name))
          if existing, do: Map.put(acc, spec.name, existing), else: acc
        else
          IO.puts("  ! #{spec.name}: #{inspect(errs)}")
          acc
        end
    end
  end)

# ── 2. Equipment units ────────────────────────────────────────────
#
# Each spec targets an item by external_sku, defines how many units
# to make, and carries realistic manufacturer/model/cost/cadence
# defaults. Serial numbers are generated as {serial_prefix}-{index}
# with zero-padding — mirrors the "asset tag" style operators
# typically stick on the physical unit.

# {sku, count, category_name, manufacturer, model, serial_prefix,
#  unit_cost, currency, calib_months, maint_months, useful_life_years,
#  age_range_years}
units_spec = [
  # ── Lab & QC ────────────────────────────────────────────────────
  {"EQ-BAL-ANAL", 3, "Weighing equipment", "Mettler Toledo", "XPR205", "MET-BAL",
   3800.00, "GBP", 12, 12, 12, {0, 4}},
  {"EQ-BAL-PREC", 2, "Weighing equipment", "Sartorius", "Entris II BCA", "SART-PB",
   1450.00, "GBP", 12, 12, 12, {0, 4}},
  {"EQ-BAL-FLOOR", 2, "Weighing equipment", "Kern", "IFB 600K200DM", "KRN-FS",
   2100.00, "GBP", 12, 12, 12, {1, 5}},
  {"EQ-PH-1", 2, "Lab & QC instruments", "Mettler Toledo", "SevenExcellence S400", "MET-PH",
   1250.00, "GBP", 6, 12, 10, {0, 4}},
  {"EQ-MOIST-1", 1, "Lab & QC instruments", "Mettler Toledo", "HE73", "MET-MOI",
   1780.00, "GBP", 12, 12, 10, {0, 3}},
  {"EQ-HARD-1", 1, "Lab & QC instruments", "Erweka", "TBH 425", "ERW-HD", 4900.00,
   "GBP", 12, 12, 12, {1, 5}},
  {"EQ-DIS-1", 1, "Lab & QC instruments", "Erweka", "ZT 122", "ERW-DIS", 5600.00,
   "GBP", 12, 12, 12, {1, 5}},
  {"EQ-DISS-1", 1, "Lab & QC instruments", "Distek", "Evolution 6300", "DTK-DISS",
   12500.00, "GBP", 6, 12, 12, {0, 4}},
  {"EQ-FRIA-1", 1, "Lab & QC instruments", "Copley", "FRV 2000", "COP-FRI",
   3200.00, "GBP", 12, 12, 12, {1, 5}},
  {"EQ-DENS-1", 1, "Lab & QC instruments", "Copley", "JV 2000", "COP-DEN",
   2800.00, "GBP", 12, 12, 12, {1, 5}},
  {"EQ-VISC-1", 1, "Lab & QC instruments", "Brookfield", "DV2T", "BRK-VIS",
   3600.00, "GBP", 12, 12, 12, {0, 4}},
  {"EQ-REFR-1", 1, "Lab & QC instruments", "Anton Paar", "Abbemat 300", "AP-REFR",
   4100.00, "GBP", 12, 12, 12, {0, 3}},
  {"EQ-KF-1", 1, "Lab & QC instruments", "Metrohm", "870 KF Titrino Plus", "MTR-KF",
   7600.00, "GBP", 12, 12, 12, {1, 4}},
  {"EQ-TITR-1", 1, "Lab & QC instruments", "Metrohm", "916 Ti-Touch", "MTR-TIT",
   9200.00, "GBP", 12, 12, 12, {0, 4}},
  {"EQ-HPLC-1", 1, "Lab & QC instruments", "Agilent", "1260 Infinity II", "AGL-HPLC",
   38500.00, "GBP", 6, 6, 10, {1, 5}},
  {"EQ-UV-1", 1, "Lab & QC instruments", "Thermo Scientific", "GENESYS 50", "TS-UV",
   6200.00, "GBP", 12, 12, 12, {0, 4}},
  {"EQ-MICRO-1", 1, "Lab & QC instruments", "Olympus", "CX23", "OLY-MIC", 2100.00,
   "GBP", nil, 24, 15, {2, 6}},
  {"EQ-INCU-1", 1, "Lab & QC instruments", "Memmert", "IN75", "MEM-INC", 2900.00,
   "GBP", 12, 12, 12, {1, 5}},
  {"EQ-AUTO-1", 1, "Lab & QC instruments", "Systec", "DX-45", "SYS-AUT", 8400.00,
   "GBP", 12, 12, 10, {0, 4}},
  {"EQ-WATER-1", 1, "Lab & QC instruments", "Grant", "T100-ST26", "GNT-WB", 1200.00,
   "GBP", 12, 24, 10, {1, 5}},
  {"EQ-ROTA-1", 1, "Lab & QC instruments", "Buchi", "R-300", "BUC-RE", 6800.00,
   "GBP", nil, 12, 12, {1, 4}},
  {"EQ-FUME-1", 1, "Lab & QC instruments", "Waldner", "Secuflow", "WLD-FUME",
   5400.00, "GBP", 12, 12, 15, {2, 8}},
  {"EQ-LAF-1", 1, "Lab & QC instruments", "Esco", "Airstream Class II", "ESC-LAF",
   7900.00, "GBP", 12, 12, 15, {2, 8}},

  # ── Production lines ───────────────────────────────────────────
  {"EQ-CAP-100", 2, "Filling & packaging", "IMA", "Zanasi Plus 90", "IMA-CAP",
   180_000.00, "GBP", nil, 3, 15, {2, 8}},
  {"EQ-CAP-60", 1, "Filling & packaging", "Torpac", "Cap-M-Quik 100", "TRP-CAP",
   4200.00, "GBP", nil, 12, 10, {3, 7}},
  {"EQ-TAB-COMP", 1, "Filling & packaging", "Fette Compacting", "1200i", "FET-TAB",
   240_000.00, "GBP", nil, 3, 20, {4, 9}},
  {"EQ-TAB-COAT", 1, "Filling & packaging", "O'Hara", "LabCoat II-X", "OHA-COAT",
   95_000.00, "GBP", nil, 6, 15, {3, 8}},
  {"EQ-BLIS-1", 2, "Filling & packaging", "Uhlmann", "BEC 300", "UHL-BLIS",
   140_000.00, "GBP", nil, 3, 15, {2, 7}},
  {"EQ-DBLIS", 1, "Filling & packaging", "Sepha", "Ultra RS", "SEP-DBL", 22_500.00,
   "GBP", nil, 12, 10, {2, 6}},

  {"EQ-VMIX-500", 2, "Mixing & granulation", "Gemco", "V-blender 500L", "GEM-VB500",
   38_000.00, "GBP", nil, 12, 20, {5, 12}},
  {"EQ-VMIX-100", 2, "Mixing & granulation", "Gemco", "V-blender 100L", "GEM-VB100",
   14_500.00, "GBP", nil, 12, 20, {3, 9}},
  {"EQ-RMIX-800", 1, "Mixing & granulation", "Winkworth", "MZ800", "WIN-RB",
   45_000.00, "GBP", nil, 12, 20, {5, 12}},
  {"EQ-BINBLEND", 2, "Mixing & granulation", "Servolift", "IBC-300", "SVL-BB",
   32_000.00, "GBP", nil, 12, 15, {2, 6}},
  {"EQ-GRAN-FBG", 1, "Mixing & granulation", "Glatt", "GPCG 30", "GLT-FBG",
   180_000.00, "GBP", nil, 6, 15, {4, 10}},
  {"EQ-GRAN-HS", 1, "Mixing & granulation", "Diosna", "P/VAC 75", "DIO-HS",
   140_000.00, "GBP", nil, 6, 15, {4, 10}},
  {"EQ-MILL-CO", 1, "Mixing & granulation", "Quadro", "Comil U10", "QDR-CO",
   28_500.00, "GBP", nil, 12, 15, {3, 8}},
  {"EQ-MILL-HM", 1, "Mixing & granulation", "Fitzpatrick", "M5A", "FTZ-HM",
   34_000.00, "GBP", nil, 12, 15, {3, 8}},
  {"EQ-SIEVE-1", 2, "Mixing & granulation", "Russell Finex", "Compact Sieve 900",
   "RSL-SV", 12_800.00, "GBP", nil, 12, 15, {2, 7}},
  {"EQ-HOMOG-1", 1, "Mixing & granulation", "Silverson", "Flashmix DX",
   "SLV-HOM", 22_000.00, "GBP", nil, 12, 15, {3, 8}},
  {"EQ-COOK-1", 1, "Mixing & granulation", "Bosch", "Formatta 500L", "BSH-CK",
   68_000.00, "GBP", nil, 6, 15, {2, 6}},
  {"EQ-GUMMY-1", 1, "Filling & packaging", "Baker Perkins", "ServoForm Mini",
   "BKP-GUM", 210_000.00, "GBP", nil, 3, 15, {1, 4}},
  {"EQ-GUMMY-TUN", 1, "Filling & packaging", "Sollich", "SDL-1200", "SOL-TUN",
   85_000.00, "GBP", nil, 6, 15, {1, 4}},

  # ── Bottling / packaging ───────────────────────────────────────
  {"EQ-BTL-UNSCR", 1, "Filling & packaging", "Pace Packaging", "US-30", "PCE-UN",
   18_500.00, "GBP", nil, 6, 15, {3, 8}},
  {"EQ-BTL-COUNT", 2, "Filling & packaging", "CVC Technologies", "CVC-CT200",
   "CVC-CT", 28_000.00, "GBP", nil, 6, 12, {2, 7}},
  {"EQ-BTL-CAP", 2, "Filling & packaging", "Kaps-All", "Model E", "KAP-CP",
   19_800.00, "GBP", nil, 6, 15, {2, 8}},
  {"EQ-BTL-SEAL", 1, "Filling & packaging", "Enercon", "Super Seal 100", "ENR-SL",
   14_500.00, "GBP", 12, 6, 12, {2, 6}},
  {"EQ-LBL-1", 1, "Filling & packaging", "Herma", "132HC Wrap", "HRM-WA",
   32_500.00, "GBP", nil, 6, 15, {3, 9}},
  {"EQ-LBL-2", 1, "Filling & packaging", "Weber", "Model 5300 Twin", "WBR-FB",
   38_000.00, "GBP", nil, 6, 15, {2, 7}},
  {"EQ-CART-1", 1, "Filling & packaging", "Marchesini", "MA155", "MRC-CAR",
   145_000.00, "GBP", nil, 3, 15, {3, 8}},
  {"EQ-CASE-1", 1, "Filling & packaging", "Endoline", "744", "END-CS", 42_000.00,
   "GBP", nil, 6, 15, {2, 7}},
  {"EQ-CODE-INK", 1, "Filling & packaging", "Videojet", "1650", "VDJ-INK", 8500.00,
   "GBP", nil, 6, 8, {1, 4}},
  {"EQ-CODE-LASER", 1, "Filling & packaging", "Domino", "D320i", "DMN-LSR",
   16_500.00, "GBP", nil, 12, 10, {1, 5}},
  {"EQ-CONV-1", 2, "Filling & packaging", "Dorner", "3200 modular", "DOR-CV",
   4200.00, "GBP", nil, 12, 15, {2, 8}},

  # ── Automation ─────────────────────────────────────────────────
  {"EQ-MD-1", 1, "Automation & inspection", "Loma", "IQ4 Powder", "LOM-MD",
   28_000.00, "GBP", 6, 6, 12, {1, 5}},
  {"EQ-CW-1", 1, "Automation & inspection", "Loma", "CW3", "LOM-CW", 22_500.00,
   "GBP", 6, 6, 12, {1, 5}},
  {"EQ-VIS-1", 1, "Automation & inspection", "Cognex", "In-Sight 9902", "CGX-VIS",
   14_200.00, "GBP", 12, 12, 10, {1, 4}},

  # ── Filling & liquid dosing ────────────────────────────────────
  {"EQ-LIQ-FILL", 2, "Filling & packaging", "Cozzoli", "SF-52", "CZL-LF",
   38_000.00, "GBP", nil, 6, 15, {2, 7}},
  {"EQ-PUMP-PERI", 2, "Filling & packaging", "Watson-Marlow", "530U", "WM-PER",
   3800.00, "GBP", nil, 12, 12, {1, 5}},
  {"EQ-PUMP-LOBE", 1, "Filling & packaging", "Alfa Laval", "SRU 3", "AL-LB",
   6200.00, "GBP", nil, 12, 15, {2, 6}},
  {"EQ-TANK-500", 2, "Mixing & granulation", "GEA", "Sanistar 500L", "GEA-TK",
   28_500.00, "GBP", nil, 12, 20, {2, 8}},

  # ── Warehouse / material handling ──────────────────────────────
  {"EQ-FL-EL", 2, "Material handling", "Toyota", "8FBE16T", "TYT-FL",
   18_500.00, "GBP", nil, 6, 8, {1, 5}},
  {"EQ-FL-REACH", 1, "Material handling", "Linde", "R14", "LIN-RT", 24_500.00,
   "GBP", nil, 6, 8, {2, 6}},
  {"EQ-PJ-MAN", 5, "Material handling", "Jungheinrich", "AM 22", "JH-MPJ", 385.00,
   "GBP", nil, 12, 10, {0, 6}},
  {"EQ-PJ-EL", 2, "Material handling", "Jungheinrich", "EJE 116", "JH-EPJ",
   4200.00, "GBP", nil, 12, 8, {1, 5}},
  {"EQ-STRWR", 1, "Material handling", "Wulftec", "SML-150", "WFT-SW", 8900.00,
   "GBP", nil, 12, 12, {1, 6}},
  {"EQ-SHRINK", 1, "Filling & packaging", "Shanklin", "T-6XL", "SHK-ST", 7400.00,
   "GBP", nil, 12, 15, {2, 7}},
  {"EQ-DRUM-TL", 1, "Material handling", "Simpro", "DTB-200", "SMP-DT", 4800.00,
   "GBP", nil, 12, 12, {1, 5}},
  {"EQ-BIN-LIFT", 1, "Material handling", "Servolift", "BLC-500", "SVL-LI",
   18_500.00, "GBP", nil, 12, 15, {2, 6}},
  {"EQ-SACK-TIP", 1, "Mixing & granulation", "Palamatic", "PowderCatch", "PAL-ST",
   9800.00, "GBP", nil, 12, 15, {2, 7}},
  {"EQ-BAG-DUMP", 1, "Mixing & granulation", "Flexicon", "Bulk-Out BFF", "FLX-BD",
   28_500.00, "GBP", nil, 12, 15, {2, 6}},

  # ── Utilities & cleaning ───────────────────────────────────────
  {"EQ-COMP-1", 1, "Utilities", "Atlas Copco", "GA22 VSD+", "ATC-CP", 22_500.00,
   "GBP", nil, 6, 15, {2, 8}},
  {"EQ-DRY-1", 1, "Utilities", "Atlas Copco", "FX7", "ATC-DR", 4200.00, "GBP",
   nil, 12, 15, {2, 8}},
  {"EQ-CHILL-1", 1, "Utilities", "Trane", "CGAM 060", "TRN-CH", 18_500.00, "GBP",
   nil, 6, 15, {3, 8}},
  {"EQ-DUST-1", 1, "Utilities", "Donaldson", "DFPRO 4", "DON-DE", 12_500.00, "GBP",
   nil, 6, 15, {2, 8}},
  {"EQ-VAC-HEPA", 2, "Cleaning equipment", "Nilfisk", "ATTIX 44-2M IC", "NLF-VAC",
   1250.00, "GBP", nil, 12, 6, {0, 3}},
  {"EQ-STEAM-1", 1, "Cleaning equipment", "Karcher", "SG 4/4", "KRC-ST", 1450.00,
   "GBP", nil, 12, 6, {0, 3}},
  {"EQ-JET-1", 1, "Cleaning equipment", "Karcher", "HDS 8/18-4 C", "KRC-PW",
   3200.00, "GBP", nil, 12, 6, {1, 4}},
  {"EQ-RO-1", 1, "Utilities", "Culligan", "IWTR-2000", "CUL-RO", 26_500.00,
   "GBP", 12, 6, 15, {2, 7}},

  # ── Environmental sensors ──────────────────────────────────────
  {"EQ-DL-TEMP", 8, "Environmental sensors", "Tinytag", "TGP-4500", "TIN-DL",
   180.00, "GBP", 12, nil, 5, {0, 3}},
  {"EQ-SENS-COLD", 4, "Environmental sensors", "Comark", "RF500", "CMK-CS",
   240.00, "GBP", 12, nil, 5, {0, 3}},
  {"EQ-CO2-1", 1, "Environmental sensors", "Rotronic", "CO2 Display", "ROT-CO2",
   420.00, "GBP", 12, nil, 5, {0, 3}},

  # ── IT / office ────────────────────────────────────────────────
  {"EQ-LT-DEV", 4, "IT hardware", "Apple", "MacBook Pro M3 14\"", "APL-DEV",
   2400.00, "GBP", nil, nil, 4, {0, 3}},
  {"EQ-LT-OFF", 18, "IT hardware", "Lenovo", "ThinkPad T14 Gen 4", "LNV-OFF",
   1200.00, "GBP", nil, nil, 4, {0, 4}},
  {"EQ-DT-OFF", 6, "IT hardware", "Dell", "OptiPlex 7010", "DEL-DT", 780.00,
   "GBP", nil, nil, 5, {1, 5}},
  {"EQ-MON-27", 24, "IT hardware", "Dell", "U2723QE 27\"", "DEL-MON", 380.00,
   "GBP", nil, nil, 6, {0, 4}},
  {"EQ-TV-55", 3, "Network & AV", "Samsung", "QM55C Signage", "SMS-TV", 950.00,
   "GBP", nil, nil, 6, {0, 3}},
  {"EQ-DOCK-1", 12, "IT hardware", "Dell", "WD22TB4", "DEL-DOCK", 220.00, "GBP",
   nil, nil, 5, {0, 4}},
  {"EQ-KVM-1", 1, "IT hardware", "ATEN", "CS1768", "ATN-KVM", 320.00, "GBP",
   nil, nil, 6, {1, 5}},
  {"EQ-PRT-LBL", 4, "IT hardware", "Zebra", "ZT411", "ZBR-LBL", 950.00, "GBP",
   nil, 12, 6, {0, 4}},
  {"EQ-PRT-A4", 2, "IT hardware", "HP", "Color LaserJet MFP M480f", "HP-MFP",
   580.00, "GBP", nil, 12, 5, {0, 4}},
  {"EQ-SCAN-HHT", 6, "IT hardware", "Zebra", "DS8100", "ZBR-HHT", 320.00, "GBP",
   nil, nil, 5, {0, 3}},
  {"EQ-SCAN-WL", 4, "IT hardware", "Zebra", "DS8178", "ZBR-WL", 420.00, "GBP",
   nil, nil, 5, {0, 3}},
  {"EQ-TAB-WHS", 10, "IT hardware", "Zebra", "ET51", "ZBR-TAB", 780.00, "GBP",
   nil, nil, 4, {0, 3}},
  {"EQ-RAD-1", 12, "Network & AV", "Motorola", "DP1400", "MOT-RAD", 165.00, "GBP",
   nil, nil, 6, {0, 4}},
  {"EQ-ROUTER-1", 6, "Network & AV", "Ubiquiti", "UniFi U6-Pro", "UBQ-AP", 180.00,
   "GBP", nil, nil, 6, {0, 3}},
  {"EQ-UPS-1", 1, "Network & AV", "APC", "Smart-UPS SRT 3000", "APC-UPS",
   1800.00, "GBP", nil, 12, 6, {1, 5}}
]

# ── Helpers ────────────────────────────────────────────────────────

# Small deterministic-but-varied jitter — hash the input string and
# map into a range. Keeps re-runs producing the same acquired dates,
# unit costs, and manufacturer serials so history is stable between
# seed runs.
defmodule EquipSeed do
  def hash_int(seed) do
    :erlang.phash2(seed, 1_000_000_000)
  end

  def jitter(seed, min_val, max_val) do
    span = max_val - min_val
    if span <= 0 do
      min_val
    else
      min_val + rem(hash_int(seed), span + 1)
    end
  end

  def jitter_pct(seed, base) do
    # ±15% variance on cost so a fleet has spread instead of clones.
    delta = base * 0.15
    variance = (rem(hash_int(seed), 300) - 150) / 1000.0
    round_dp(base + delta * variance, 2)
  end

  defp round_dp(n, dp) do
    m = :math.pow(10, dp)
    Float.round(n * m) / m
  end

  def days_ago(seed, {min_years, max_years}) do
    min_days = min_years * 365
    max_days = max_years * 365
    jitter(seed, min_days, max_days)
  end

  def pad(n, width \\ 3) do
    n |> Integer.to_string() |> String.pad_leading(width, "0")
  end
end

items_by_sku =
  from(i in Backend.Items.Item,
    where: i.company_id == ^company_id and i.item_type == "equipment",
    select: {i.external_sku, i}
  )
  |> Repo.all()
  |> Enum.into(%{})

IO.puts("")
IO.puts("Seeding equipment units…")

{inserted, skipped, missing_sku, failed} =
  Enum.reduce(units_spec, {0, 0, [], []}, fn spec, {ins, skip, miss, fail} ->
    {sku, count, cat_name, manufacturer, model, serial_prefix, base_cost,
     currency, calib_m, maint_m, useful_life, age_range} = spec

    case Map.fetch(items_by_sku, sku) do
      :error ->
        {ins, skip, [sku | miss], fail}

      {:ok, item} ->
        category = Map.get(category_by_name, cat_name)

        Enum.reduce(1..count, {ins, skip, miss, fail}, fn idx, {ins2, skip2, miss2, fail2} ->
          seed_key = "#{sku}-#{idx}"
          serial = "#{serial_prefix}-#{EquipSeed.pad(idx)}"
          mfr_serial = "#{serial_prefix}#{EquipSeed.hash_int(seed_key) |> rem(100_000) |> EquipSeed.pad(5)}"

          days_since_acq = EquipSeed.days_ago(seed_key, age_range)
          acquired_at = DateTime.add(now, -days_since_acq * 86400, :second)
          warranty_end =
            case age_range do
              {_, _} when useful_life <= 6 ->
                # 2-3 year warranty typical for small kit
                acquired_at |> DateTime.to_date() |> Date.add(365 * 2)

              _ ->
                # 12-month manufacturer warranty on big kit
                acquired_at |> DateTime.to_date() |> Date.add(365)
            end

          unit_cost = EquipSeed.jitter_pct(seed_key, base_cost)

          next_calib =
            if calib_m,
              do: DateTime.add(acquired_at, calib_m * 30 * 86400, :second),
              else: nil

          next_maint =
            if maint_m,
              do: DateTime.add(acquired_at, maint_m * 30 * 86400, :second),
              else: nil

          attrs = %{
            "item_id" => item.id,
            "category_id" => category && category.id,
            "serial_number" => serial,
            "manufacturer_serial" => mfr_serial,
            "manufacturer" => manufacturer,
            "model" => model,
            "unit_cost" => Decimal.from_float(unit_cost),
            "currency" => currency,
            "acquired_at" => acquired_at,
            "warranty_end_at" => warranty_end,
            "useful_life_years" => useful_life,
            "calibration_frequency_months" => calib_m,
            "next_calibration_at" => next_calib,
            "maintenance_frequency_months" => maint_m,
            "next_maintenance_at" => next_maint,
            "reason" => "Opening balance — seed",
            "source" => "seed_script"
          }

          case Equipment.create(actor, company_id, attrs) do
            {:ok, _eq} ->
              {ins2 + 1, skip2, miss2, fail2}

            {:error, %Ecto.Changeset{errors: errs}} ->
              if Enum.any?(errs, fn {f, _} -> f == :serial_number end) do
                {ins2, skip2 + 1, miss2, fail2}
              else
                {ins2, skip2, miss2, [{serial, errs} | fail2]}
              end

            {:error, reason} ->
              {ins2, skip2, miss2, [{serial, reason} | fail2]}
          end
        end)
    end
  end)

IO.puts("")
IO.puts("Equipment-unit seed complete:")
IO.puts("  inserted: #{inserted}")
IO.puts("  skipped (already existed): #{skipped}")

if missing_sku != [] do
  IO.puts("  ⚠ missing SKUs (item not seeded): #{inspect(Enum.uniq(missing_sku))}")
end

if failed != [] do
  IO.puts("  FAILED (#{length(failed)}):")
  for {serial, err} <- failed do
    IO.puts("    - #{serial}: #{inspect(err)}")
  end
end
