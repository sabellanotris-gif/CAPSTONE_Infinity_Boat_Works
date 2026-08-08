/* ============================================
   SHARED BOAT DATA SERVICE
   Central source of truth for boat specifications,
   materials, activities, milestones, timelines,
   and delivery info.
   Data can be moved to DB tables later by
   populating boat_data tables and removing
   the hardcoded fallbacks.
   ============================================ */

const API_BASE = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

// ---- Hardcoded fallback data ----

const BOAT_SPECS = {
  "1950 Passenger Boat": {
    length: "19.5 meters", width: "2.5 meters", breadth: "4.2 meters",
    depth: "1.6 meters", height: "1.6 meters",
    passengerCapacity: "65 passengers + 2 crew",
    enginePower: "700 HP", maxSpeed: "18 knots",
    basePrice: "₱50,000,000"
  },
  "2680 Passenger Boat": {
    length: "26.8 meters", width: "3.5 meters", breadth: "6.0 meters",
    depth: "2.3 meters", height: "2.3 meters",
    passengerCapacity: "180 passengers + 4 crew",
    enginePower: "1800 HP x2", maxSpeed: "25 knots",
    basePrice: "₱115,000,000"
  },
  "Patrol Boat": {
    length: "12 meters", width: "2.8 meters", breadth: "3.3 meters",
    depth: "1.5 meters", height: "1.5 meters",
    passengerCapacity: "4 personnel",
    enginePower: "500 HP", maxSpeed: "32 knots",
    basePrice: "₱15,000,000"
  },
  "Speed Boat": {
    length: "5.8 meters", width: "1.2 meters", breadth: "2.25 meters",
    depth: "0.9 meters", height: "0.9 meters",
    passengerCapacity: "5 passengers",
    enginePower: "90-115 HP", maxSpeed: "36-40 knots",
    basePrice: "₱1,400,000"
  },
  "Parasail Boat": {
    length: "11 meters", width: "2.5 meters", breadth: "3.0 meters",
    depth: "1.5 meters", height: "1.5 meters",
    passengerCapacity: "10 passengers + 2 crew",
    enginePower: "300 HP", maxSpeed: "20 knots",
    basePrice: "₱8,500,000"
  }
};

const BOAT_MATERIALS = {
  "1950 Passenger Boat": {
    hullMaterial: "Fiberglass — ISO/NPG Gelcoat + 450gsm CSM + 600gsm Woven Roving (8 layers)",
    coreMaterial: "End-grain Balsa wood (above waterline) / Solid GRP (below waterline)",
    structuralStringers: "Foam-cored fiberglass hat-section stringers, 400mm spacing",
    bulkheadMaterial: "Marine-grade plywood, glassed with 3 layers CSM tabbing",
    deckMaterial: "Fiberglass with molded diamond-pattern nonskid gelcoat",
    resinType: "Polyester / Vinylester (isophthalic for gelcoat)",
    exteriorFinish: "Awlgrip / Alexseal marine polyurethane paint",
    antiFouling: "Self-polishing copolymer anti-fouling paint (below waterline)",
    engineType: "Inboard Diesel",
    engineMake: "Yanmar / Cummins",
    enginePower: "700 HP",
    propeller: "Stainless steel Nibral 4-blade propeller",
    shaftMaterial: "Aqualoy 22 stainless steel shafting",
    electricalSystem: "Marine-grade tinned copper wiring, waterproof connectors",
    batteries: "Deep-cycle marine batteries (2 x 100Ah)",
    panelType: "Waterproof switch panel with VSR",
    fuelTank: "Stainless steel 316L fuel tank",
    fuelLines: "USCG-approved A1-45 fuel hose with anti-siphon valve",
    waterSystem: "Fresh water tank + marine pressure pump + 12V faucet",
    holdingTank: "Polyethylene holding tank with deck pump-out",
    windows: "Marine-grade tempered glass in rubber gasket frame",
    rubrail: "PVC D-section rubrail with stainless steel insert",
    cleatsAndHardware: "316L stainless steel marine-grade hardware",
    lifeRafts: "SOLAS-approved 25-person life raft (valise type)",
    lifeJackets: "Adult 150N foam life jackets with whistle + light",
    fireSystem: "Fixed fire suppression in engine room + portable ABC extinguishers"
  },
  "2680 Passenger Boat": {
    hullMaterial: "Fiberglass — ISO/NPG Gelcoat + 450gsm CSM + 800gsm Woven Roving (12 layers, heavy-duty)",
    coreMaterial: "PVC foam core (Divinycell) 20mm with solid GRP below waterline",
    structuralStringers: "Foam-cored fiberglass hat-section stringers, 300mm spacing",
    bulkheadMaterial: "Marine-grade plywood, glassed with 4 layers CSM tabbing",
    deckMaterial: "Fiberglass with molded diamond-pattern nonskid gelcoat",
    resinType: "Vinylester (hull) / Polyester (superstructure)",
    exteriorFinish: "Awlgrip / Alexseal marine polyurethane paint",
    antiFouling: "Self-polishing copolymer anti-fouling paint (below waterline)",
    engineType: "Twin Inboard Diesel",
    engineMake: "Cummins / MAN",
    enginePower: "1800 HP x2",
    propeller: "Stainless steel Nibral 5-blade propellers (x2)",
    shaftMaterial: "Aqualoy 22 stainless steel shafting (x2)",
    electricalSystem: "Heavy-duty marine-grade tinned copper wiring, dual alternators",
    batteries: "Deep-cycle AGM battery bank (4 x 200Ah)",
    panelType: "Waterproof switch panel with VSR and monitoring system",
    fuelTank: "Dual stainless steel 316L fuel tanks with cross-feed",
    fuelLines: "USCG-approved A1-45 fuel hose with anti-siphon valve",
    waterSystem: "Fresh water tank + marine pressure pump + 12V faucet",
    holdingTank: "Polyethylene holding tank with deck pump-out",
    windows: "Marine-grade tempered glass in rubber gasket frame",
    rubrail: "PVC D-section rubrail with stainless steel insert",
    cleatsAndHardware: "316L stainless steel, through-bolted with backing plates",
    lifeRafts: "SOLAS-approved 50-person life raft (valise type)",
    lifeJackets: "Adult 150N foam life jackets with whistle + light",
    fireSystem: "Automatic fire suppression in engine room + portable ABC extinguishers"
  },
  "Passenger Boat": {
    hullMaterial: "Fiberglass — ISO/NPG Gelcoat + 450gsm CSM + 600gsm Woven Roving (8 layers)",
    coreMaterial: "End-grain Balsa wood (above waterline) / Solid GRP (below waterline)",
    structuralStringers: "Foam-cored fiberglass hat-section stringers, 400mm spacing",
    bulkheadMaterial: "Marine-grade plywood, glassed with 3 layers CSM tabbing",
    deckMaterial: "Fiberglass with molded diamond-pattern nonskid gelcoat",
    resinType: "Polyester / Vinylester (isophthalic for gelcoat)",
    exteriorFinish: "Awlgrip / Alexseal marine polyurethane paint",
    antiFouling: "Self-polishing copolymer anti-fouling paint (below waterline)",
    engineType: "Inboard Diesel or Twin Outboards",
    engineMake: "Yanmar / Cummins (inboard) or Yamaha / Suzuki (outboard)",
    enginePower: "600 HP",
    propeller: "Stainless steel Nibral 4-blade propeller",
    shaftMaterial: "Aqualoy 22 stainless steel shafting",
    electricalSystem: "Marine-grade tinned copper wiring, waterproof connectors",
    batteries: "Deep-cycle marine batteries (2 x 100Ah)",
    panelType: "Waterproof switch panel with VSR",
    fuelTank: "Stainless steel 316L fuel tank",
    fuelLines: "USCG-approved A1-45 fuel hose with anti-siphon valve",
    waterSystem: "Fresh water tank + marine pressure pump + 12V faucet",
    holdingTank: "Polyethylene holding tank with deck pump-out",
    windows: "Marine-grade tempered glass in rubber gasket frame",
    rubrail: "PVC D-section rubrail with stainless steel insert",
    cleatsAndHardware: "316L stainless steel marine-grade hardware",
    lifeRafts: "SOLAS-approved 25-person life raft (valise type)",
    lifeJackets: "Adult 150N foam life jackets with whistle + light",
    fireSystem: "Fixed fire suppression in engine room + portable ABC extinguishers"
  },
  "Patrol Boat": {
    hullMaterial: "Reinforced Fiberglass — ISO/NPG Gelcoat + 450gsm CSM + 800gsm Woven Roving (12 layers) with Kevlar inserts",
    coreMaterial: "PVC foam core (Divinycell) 20mm with solid GRP skins",
    structuralStringers: "Foam-cored fiberglass hat-section stringers, 300mm spacing",
    bulkheadMaterial: "Aluminum honeycomb panels, glassed with 4 layers CSM tabbing",
    deckMaterial: "Fiberglass with molded nonskid pattern, aluminum treadplate in high-traffic areas",
    resinType: "Vinylester resin for impact resistance",
    exteriorFinish: "Military-grade polyurethane paint (camo or grey)",
    antiFouling: "Copper-based anti-fouling paint (below waterline)",
    engineType: "Twin Outboards or Inboard Waterjet",
    engineMake: "Yamaha / Suzuki 300HP (outboard) or Hamilton Waterjet (inboard)",
    enginePower: "800 HP (twin 400HP)",
    propeller: "Stainless steel Nibral 4-blade (for outboard) / Waterjet impeller (for inboard)",
    shaftMaterial: "Aqualoy 22 stainless steel shafting (for inboard)",
    electricalSystem: "MIL-spec tinned copper wiring, waterproof military connectors",
    batteries: "Heavy-duty AGM deep-cycle batteries (4 x 100Ah)",
    panelType: "MIL-spec waterproof switch panel with redundant systems",
    fuelTank: "Dual stainless steel 316L fuel tanks with cross-feed",
    fuelLines: "USCG-approved A1-45 fuel hose with anti-siphon valve",
    waterSystem: "Fresh water tank + pressure pump (for crew accommodation)",
    holdingTank: "Polyethylene holding tank with deck pump-out",
    windows: "Bullet-resistant laminated glass (optional) / Tempered marine glass",
    rubrail: "Heavy-duty aluminum rubrail with rubber insert",
    cleatsAndHardware: "316L stainless steel, through-bolted with backing plates",
    lifeRafts: "SOLAS-approved 15-person life raft",
    lifeJackets: "Military-spec life vests with MOB lights",
    fireSystem: "Automatic fire suppression in engine room + handheld extinguishers"
  },
  "Speed Boat": {
    hullMaterial: "Fiberglass — Gelcoat + 300gsm CSM + 600gsm Woven Roving (6 layers, lightweight)",
    coreMaterial: "PVC foam core (6-12mm) above waterline",
    structuralStringers: "Foam-cored fiberglass stringers, 500mm spacing",
    bulkheadMaterial: "Marine-grade plywood, glassed with 2 layers CSM",
    deckMaterial: "Fiberglass with molded nonskid pattern",
    resinType: "Polyester resin (orthophthalic)",
    exteriorFinish: "High-gloss polyurethane paint (custom colors / metallic flake)",
    antiFouling: "Not required (trailerable boat) / Optional copper-based",
    engineType: "Outboard Motor",
    engineMake: "Yamaha / Suzuki / Mercury (200-350HP)",
    enginePower: "500 HP",
    propeller: "Stainless steel or aluminum 3-blade propeller",
    shaftMaterial: "Not applicable (outboard)",
    electricalSystem: "Marine-grade tinned copper wiring, waterproof connectors",
    batteries: "Starter battery + deep-cycle house battery",
    panelType: "Waterproof rocker switch panel with USB charging ports",
    fuelTank: "Roto-molded polyethylene or aluminum under-deck fuel tank",
    fuelLines: "USCG-approved fuel hose with anti-siphon valve",
    waterSystem: "Not standard / Optional portable cooler",
    holdingTank: "Not standard / Optional portable head",
    windows: "Acrylic windshield with stainless steel frame",
    rubrail: "PVC rubrail with aluminum insert",
    cleatsAndHardware: "316L stainless steel marine-grade hardware",
    lifeRafts: "Not required (recreational) / Optional portable raft",
    lifeJackets: "Standard foam life jackets (4-8 pcs)",
    fireSystem: "Portable ABC fire extinguisher"
  },
  "Parasail Boat": {
    hullMaterial: "Fiberglass — Heavy-duty ISO/NPG Gelcoat + 450gsm CSM + 800gsm Woven Roving (12+ layers)",
    coreMaterial: "PVC foam core (Divinycell) 15-20mm with solid GRP below waterline",
    structuralStringers: "Foam-filled fiberglass hat-section stringers, 400mm spacing",
    bulkheadMaterial: "Marine-grade plywood, glassed with 3 layers CSM tabbing",
    deckMaterial: "Fiberglass with molded diamond-pattern nonskid (self-bailing deck)",
    resinType: "Vinylester resin (engine room) / Polyester (hull)",
    exteriorFinish: "Heavy-duty polyurethane paint with UV protectants",
    antiFouling: "Self-polishing copolymer anti-fouling paint (below waterline)",
    engineType: "Twin Outboards (preferred) or Inboard with PTO",
    engineMake: "Yamaha / Suzuki 250-350HP (outboard) / Cummins (inboard)",
    enginePower: "400 HP (twin 200HP)",
    propeller: "Stainless steel Nibral 4-blade propeller",
    shaftMaterial: "Aqualoy 22 stainless steel shafting (for inboard)",
    electricalSystem: "Heavy-duty marine-grade wiring, dual alternators",
    batteries: "Deep-cycle AGM battery bank (4 x 100Ah)",
    panelType: "Waterproof switch panel with winch controls integrated",
    fuelTank: "Large capacity stainless steel 316L fuel tank (250L+)",
    fuelLines: "USCG-approved A1-45 fuel hose with anti-siphon valve",
    waterSystem: "Fresh water tank + pressure pump",
    holdingTank: "Polyethylene holding tank with deck pump-out",
    windows: "Marine-grade tempered glass in rubber gasket frame",
    rubrail: "Heavy-duty PVC D-section rubrail with stainless steel insert",
    cleatsAndHardware: "316L stainless steel, through-bolted with backing plates",
    lifeRafts: "SOLAS-approved 15-person life raft",
    lifeJackets: "Slim-profile parasailing life jackets with harness attachment points",
    fireSystem: "Automatic fire suppression in engine room + portable extinguishers",
    winchSystem: "Hydraulic winch (200-400ft drum capacity) with automatic fail-safe brake",
    winchRope: "Dyneema/Spectra rope 3/8-5/8in diameter",
    roller: "2-3in diameter 316L stainless steel roller on heavy-duty bracket",
    safetyRails: "1.25in 316L stainless steel tubing with backing plates",
    towPylon: "Reinforced stainless steel tow pylon with FEA-certified structural base",
    parasailCanopy: "Ripstop nylon parasail canopy (sized for operation)",
    passengerHarnesses: "Padded harness system with quick-release connectors",
    communicationSystem: "Hand signals / VHF radio / intercom system"
  }
};

const BOAT_SIMPLE_MATERIALS = {
  "1950 Passenger Boat": { materials: ["Fiberglass Hull", "Fiberglass Roof", "Marine Grade Passenger Seating", "Tempered Glass Windows"], engine: "Yanmar / Cummins Inboard Diesel — 700 HP" },
  "2680 Passenger Boat": { materials: ["Heavy-Duty Fiberglass Hull", "Reinforced Superstructure", "Passenger Cabin with AC", "Marine Grade Passenger Seating (180 pax)", "Tempered Glass Windows"], engine: "Twin Cummins / MAN Inboard Diesel — 1800 HP x2" },
  "Passenger Boat": { materials: ["Fiberglass Hull", "Fiberglass Roof", "Marine Grade Passenger Seating", "Tempered Glass Windows"], engine: "Mercury or Suzuki — Inboard or Outboard Configuration" },
  "Speed Boat": { materials: ["Lightweight Fiberglass Hull", "Composite Reinforcement Materials", "High-Speed Performance Engine", "Marine Electrical Systems"], engine: "Mercury Performance Series / Suzuki High Output Series" },
  "Parasail Boat": { materials: ["Reinforced Fiberglass Hull", "Heavy-Duty Tow Structure", "Hydraulic Winch System", "Marine Communication Equipment"], engine: "Minimum 300 HP — Commercial Grade Tow Engine" },
  "Patrol Boat": { materials: ["Marine Grade Aluminum or Steel Hull", "Reinforced Bulkheads", "Radar Systems", "Communication Equipment", "Navigation Systems"], engine: "High-Endurance Patrol Engine / Heavy-Duty Propulsion System" }
};

const BOAT_MILESTONES = {
  "1950 Passenger Boat": [
    { label: "Design Phase Completed", percentage: 10, key: "design" },
    { label: "Engineering Review Completed", percentage: 25, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 40, key: "marina" },
    { label: "Hull & Cabin Construction", percentage: 60, key: "construction" },
    { label: "Interior Fit-Out & Systems", percentage: 80, key: "outfitting" },
    { label: "Sea Trial Completed", percentage: 90, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ],
  "2680 Passenger Boat": [
    { label: "Design Phase Completed", percentage: 8, key: "design" },
    { label: "Engineering Review Completed", percentage: 20, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 35, key: "marina" },
    { label: "Hull Construction", percentage: 50, key: "construction" },
    { label: "Twin Engine Installation", percentage: 65, key: "engines" },
    { label: "Cabin & Interior Fit-Out", percentage: 80, key: "outfitting" },
    { label: "Sea Trial Completed", percentage: 92, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ],
  "Passenger Boat": [
    { label: "Design Phase Completed", percentage: 10, key: "design" },
    { label: "Engineering Review Completed", percentage: 25, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 40, key: "marina" },
    { label: "Hull & Cabin Construction", percentage: 60, key: "construction" },
    { label: "Interior Fit-Out & Systems", percentage: 80, key: "outfitting" },
    { label: "Sea Trial Completed", percentage: 90, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ],
  "Patrol Boat": [
    { label: "Design Phase Completed", percentage: 10, key: "design" },
    { label: "Engineering Review Completed", percentage: 25, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 40, key: "marina" },
    { label: "Heavy-Duty Hull Construction", percentage: 55, key: "construction" },
    { label: "Systems & Armament Integration", percentage: 75, key: "systems" },
    { label: "Sea Trial Completed", percentage: 90, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ],
  "Speed Boat": [
    { label: "Design Phase Completed", percentage: 10, key: "design" },
    { label: "Engineering Review Completed", percentage: 25, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 40, key: "marina" },
    { label: "Hull & Deck Construction", percentage: 60, key: "construction" },
    { label: "Engine & Systems Installation", percentage: 80, key: "outfitting" },
    { label: "Sea Trial Completed", percentage: 90, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ],
  "Parasail Boat": [
    { label: "Design Phase Completed", percentage: 10, key: "design" },
    { label: "Engineering Review Completed", percentage: 25, key: "engineering" },
    { label: "MARINA Requirements Submitted", percentage: 40, key: "marina" },
    { label: "Hull Construction", percentage: 50, key: "construction" },
    { label: "Winch System Installation", percentage: 70, key: "winch" },
    { label: "Sea Trial Completed", percentage: 90, key: "seatrial" },
    { label: "Ready for Delivery", percentage: 100, key: "delivery" }
  ]
};

const BOAT_ACTIVITIES = {
  "1950 Passenger Boat": [
    { title: "Design Phase Started", description: "Initial design and layout planning for 1950 passenger vessel commenced.", department: "Design", status: "completed" },
    { title: "Passenger Layout Approved", description: "65-pax seating and cabin layout approved by engineering.", department: "Design", status: "completed" },
    { title: "MARINA Requirements Submitted", description: "MARINA compliance documents submitted for regulatory review.", department: "Regulatory", status: "in-progress" },
    { title: "Hull Construction Completed", description: "Main hull structure fabricated and inspected.", department: "Construction", status: "pending" },
    { title: "Engine Installation Completed", description: "700 HP main engine mounted and aligned.", department: "Mechanical", status: "pending" },
    { title: "Interior Seating Installed", description: "Marine grade passenger seating (65 pax) installed and secured.", department: "Interior", status: "pending" },
    { title: "Sea Trial Completed", description: "Sea trial conducted and performance verified.", department: "QC", status: "pending" },
    { title: "Delivery Preparation Completed", description: "Final inspection and delivery preparation completed.", department: "Logistics", status: "pending" }
  ],
  "2680 Passenger Boat": [
    { title: "Design Phase Started", description: "Initial design and layout planning for 2680 passenger vessel commenced.", department: "Design", status: "completed" },
    { title: "Passenger Layout Approved", description: "180-pax seating and cabin layout approved by engineering.", department: "Design", status: "completed" },
    { title: "MARINA Requirements Submitted", description: "MARINA compliance documents submitted for regulatory review.", department: "Regulatory", status: "in-progress" },
    { title: "Hull Construction Completed", description: "Heavy-duty hull structure fabricated and inspected.", department: "Construction", status: "pending" },
    { title: "Twin Engine Installation Completed", description: "Twin 1800 HP engines mounted and aligned.", department: "Mechanical", status: "pending" },
    { title: "Cabin & Interior Fit-Out", description: "Passenger cabin, seating (180 pax), and amenities installed.", department: "Interior", status: "pending" },
    { title: "Electrical Systems Integrated", description: "Dual alternator electrical system fully integrated.", department: "Electrical", status: "pending" },
    { title: "Sea Trial Completed", description: "Sea trial conducted and performance verified.", department: "QC", status: "pending" },
    { title: "Delivery Preparation Completed", description: "Final inspection and delivery preparation completed.", department: "Logistics", status: "pending" }
  ],
  "Passenger Boat": [
    { title: "Design Phase Started", description: "Initial design and layout planning for passenger vessel commenced.", department: "Design", status: "completed" },
    { title: "Passenger Layout Approved", description: "Passenger seating and cabin layout approved by engineering.", department: "Design", status: "completed" },
    { title: "MARINA Requirements Submitted", description: "MARINA compliance documents submitted for regulatory review.", department: "Regulatory", status: "in-progress" },
    { title: "Hull Construction Completed", description: "Main hull structure fabricated and inspected.", department: "Construction", status: "pending" },
    { title: "Fiberglass Installation Completed", description: "Fiberglass layup and curing completed for hull and deck.", department: "Construction", status: "pending" },
    { title: "Engine Installation Completed", description: "Main propulsion engine mounted and aligned.", department: "Mechanical", status: "pending" },
    { title: "Interior Seating Installed", description: "Marine grade passenger seating installed and secured.", department: "Interior", status: "pending" },
    { title: "Sea Trial Completed", description: "Sea trial conducted and performance verified.", department: "QC", status: "pending" },
    { title: "Delivery Preparation Completed", description: "Final inspection and delivery preparation completed.", department: "Logistics", status: "pending" }
  ],
  "Speed Boat": [
    { title: "Performance Design Approved", description: "High-speed performance design specifications approved.", department: "Design", status: "completed" },
    { title: "Hull Mold Construction Completed", description: "Lightweight hull mold constructed and verified.", department: "Construction", status: "completed" },
    { title: "Fiberglass Hull Fabrication Completed", description: "Lightweight fiberglass hull fabrication completed.", department: "Construction", status: "in-progress" },
    { title: "Engine Installation Completed", description: "High-performance engine installed and calibrated.", department: "Mechanical", status: "pending" },
    { title: "Steering System Installed", description: "Precision steering system installed and tested.", department: "Mechanical", status: "pending" },
    { title: "Electrical System Integrated", description: "Marine electrical system fully integrated.", department: "Electrical", status: "pending" },
    { title: "Water Testing Conducted", description: "Water testing conducted for performance validation.", department: "QC", status: "pending" },
    { title: "Final Inspection Completed", description: "Final quality inspection completed.", department: "QC", status: "pending" }
  ],
  "Parasail Boat": [
    { title: "Tow System Design Approved", description: "Parasail tow system design approved by engineering.", department: "Design", status: "completed" },
    { title: "Hull Reinforcement Completed", description: "Heavy-duty hull reinforcement for tow load completed.", department: "Construction", status: "completed" },
    { title: "Hydraulic Winch Installed", description: "Hydraulic winch system installed and calibrated.", department: "Mechanical", status: "in-progress" },
    { title: "Tow-Line Safety Inspection Conducted", description: "Tow-line and safety equipment inspected and certified.", department: "Safety", status: "pending" },
    { title: "Winch System Calibrated", description: "Parasail winch calibrated and load tested.", department: "Mechanical", status: "pending" },
    { title: "Sea Trial Completed", description: "Sea trial for parasail operations conducted.", department: "QC", status: "pending" },
    { title: "Final Inspection Completed", description: "Final quality inspection completed.", department: "QC", status: "pending" }
  ],
  "Patrol Boat": [
    { title: "Patrol Design Phase Started", description: "Initial patrol boat design and specifications review.", department: "Design", status: "completed" },
    { title: "Hull Reinforcement Completed", description: "Heavy-duty hull reinforcement for patrol operations completed.", department: "Construction", status: "completed" },
    { title: "Navigation Systems Installed", description: "Advanced navigation and radar systems installed.", department: "Electrical", status: "in-progress" },
    { title: "Communication Equipment Installed", description: "Secure communication equipment installed.", department: "Electrical", status: "pending" },
    { title: "Engine and Propulsion Installed", description: "High-endurance patrol engine and propulsion system installed.", department: "Mechanical", status: "pending" },
    { title: "Sea Trial Conducted", description: "Sea trial for patrol operations conducted.", department: "QC", status: "pending" },
    { title: "Final Inspection Completed", description: "Final quality inspection completed.", department: "QC", status: "pending" }
  ]
};

const BOAT_TIMELINE = {
  "1950 Passenger Boat": { totalDuration: "8 Months", phases: ["Design Phase - 2 Weeks", "Material Procurement - 3 Weeks", "Hull Construction - 8 Weeks", "Cabin & Interior - 6 Weeks", "Engine & Systems - 4 Weeks", "Sea Trial & Delivery - 2 Weeks"] },
  "2680 Passenger Boat": { totalDuration: "14 Months", phases: ["Design Phase - 4 Weeks", "Material Procurement - 6 Weeks", "Hull Construction - 14 Weeks", "Twin Engine Installation - 8 Weeks", "Cabin & Interior - 10 Weeks", "Systems Integration - 6 Weeks", "Sea Trial & Delivery - 4 Weeks"] },
  "Passenger Boat": { totalDuration: "8 Months", phases: ["Design Phase - 2 Weeks", "Material Procurement - 3 Weeks", "Hull Construction - 8 Weeks", "Cabin & Interior - 6 Weeks", "Engine & Systems - 4 Weeks", "Sea Trial & Delivery - 2 Weeks"] },
  "Patrol Boat": { totalDuration: "8 Months", phases: ["Design Phase - 2 Weeks", "Material Procurement - 3 Weeks", "Hull Construction - 8 Weeks", "Systems Integration - 6 Weeks", "Weapons & Comms - 4 Weeks", "Sea Trial & Delivery - 2 Weeks"] },
  "Speed Boat": { totalDuration: "6 Months", phases: ["Design Phase - 1 Week", "Material Procurement - 2 Weeks", "Hull Construction - 6 Weeks", "Engine & Systems - 4 Weeks", "Testing - 2 Weeks", "Delivery - 1 Week"] },
  "Parasail Boat": { totalDuration: "9 Months", phases: ["Design Phase - 2 Weeks", "Material Procurement - 3 Weeks", "Hull Construction - 8 Weeks", "Winch System - 6 Weeks", "Safety Equipment - 3 Weeks", "Sea Trial - 2 Weeks", "Delivery - 2 Weeks"] }
};

const BOAT_DELIVERY_INFO = {
  "1950 Passenger Boat": { standardLeadTime: "14 days after completion", deliveryMethod: "Land transport + sea tow / flatbed trailer", seaTrialDuration: "2 days", preparationDays: "7 days", trainingDays: "2 days" },
  "2680 Passenger Boat": { standardLeadTime: "21 days after completion", deliveryMethod: "Sea delivery with crew or heavy-haul trailer", seaTrialDuration: "4 days", preparationDays: "14 days", trainingDays: "5 days" },
  "Passenger Boat": { standardLeadTime: "14 days after completion", deliveryMethod: "Land transport + sea tow / flatbed trailer", seaTrialDuration: "2 days", preparationDays: "7 days", trainingDays: "2 days" },
  "Patrol Boat": { standardLeadTime: "21 days after completion", deliveryMethod: "Sea delivery with crew + optional flatbed", seaTrialDuration: "3 days", preparationDays: "10 days", trainingDays: "5 days" },
  "Speed Boat": { standardLeadTime: "7 days after completion", deliveryMethod: "Flatbed trailer delivery", seaTrialDuration: "1 day", preparationDays: "5 days", trainingDays: "1 day" },
  "Parasail Boat": { standardLeadTime: "14 days after completion", deliveryMethod: "Sea delivery with tug assist or flatbed", seaTrialDuration: "2 days", preparationDays: "7 days", trainingDays: "3 days" }
};

// ---- Matching helpers ----

function matchBoatKey(boatName, dict) {
  if (boatName && dict[boatName]) return dict[boatName];
  const match = Object.keys(dict).find(k => boatName && boatName.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
  return match ? dict[match] : null;
}

// ---- Specialty to phase mapping (phase-based worker scheduling) ----
// Maps a worker specialty to the boat milestone keys (phases) they participate in.
const SPECIALTY_PHASES = {
  "Engineer": ["design", "engineering", "engines", "systems"],
  "Builder": ["construction"],
  "Welder": ["construction"],
  "Fiberglass Specialist": ["construction", "winch"],
  "Electrician": ["engines", "systems", "outfitting"],
  "Painter": ["outfitting", "delivery"]
};

const MILESTONE_KEY_LABELS = {
  "design": "Design Phase",
  "engineering": "Engineering Review",
  "marina": "MARINA Requirements",
  "construction": "Hull Construction",
  "engines": "Engine Installation",
  "systems": "Systems Integration",
  "winch": "Winch System",
  "outfitting": "Interior Fit-Out",
  "seatrial": "Sea Trial",
  "delivery": "Ready for Delivery"
};

// ---- Public API ----

export { BOAT_SPECS, BOAT_MATERIALS, BOAT_SIMPLE_MATERIALS, BOAT_MILESTONES, BOAT_ACTIVITIES, BOAT_TIMELINE, BOAT_DELIVERY_INFO, SPECIALTY_PHASES, MILESTONE_KEY_LABELS };

export function getBoatSpecs(boatName) {
  return matchBoatKey(boatName, BOAT_SPECS) || BOAT_SPECS["Passenger Boat"];
}

export function getBoatMaterials(boatName) {
  return matchBoatKey(boatName, BOAT_MATERIALS) || BOAT_MATERIALS["Passenger Boat"];
}

export function getBoatSimpleMaterials(boatName) {
  return matchBoatKey(boatName, BOAT_SIMPLE_MATERIALS) || BOAT_SIMPLE_MATERIALS["Passenger Boat"];
}

export function getBoatMilestones(boatName) {
  return matchBoatKey(boatName, BOAT_MILESTONES) || BOAT_MILESTONES["Passenger Boat"];
}

export function getBoatActivities(boatName) {
  return matchBoatKey(boatName, BOAT_ACTIVITIES) || BOAT_ACTIVITIES["Passenger Boat"];
}

export function resolveMilestoneKey(boatName, milestone) {
  if (milestone && milestone.key) return milestone.key;
  if (!milestone || milestone.percentage == null) return "";
  const presets = getBoatMilestones(boatName) || [];
  const match = presets.find(p => p.percentage === milestone.percentage);
  return match ? match.key : "";
}

export function getBoatTimeline(boatName) {
  return matchBoatKey(boatName, BOAT_TIMELINE) || BOAT_TIMELINE["Passenger Boat"];
}

export function getBoatDeliveryInfo(boatName) {
  return matchBoatKey(boatName, BOAT_DELIVERY_INFO) || BOAT_DELIVERY_INFO["Passenger Boat"];
}

export function getAllBoatNames() {
  return Object.keys(BOAT_SPECS);
}

export async function fetchBoatDataFromAPI(boatName) {
  try {
    const token = localStorage.getItem("supabaseToken");
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const res = await fetch(API_BASE + "/api/boat-data/" + encodeURIComponent(boatName), { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
