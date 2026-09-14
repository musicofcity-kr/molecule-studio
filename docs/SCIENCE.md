# Scientific methods and limits

This service is an educational molecular-model generator. It converts one small, connected molecular graph into a reproducible 3D conformer, a 2D depiction, basic RDKit descriptors, conservative local VSEPR labels, and broad spectroscopy reference regions. It does not calculate an experimental structure or a laboratory spectrum.

## Structure generation

The input is parsed and sanitized by RDKit. SMILES uses `MolFromSmiles`; mol blocks use strict `MolFromMolBlock` parsing; editor graphs are built as an `RWMol` and then sanitized. Sanitization is required because an editable graph can otherwise retain chemically inconsistent valence or aromaticity. RDKit's own introduction likewise warns that edited molecules should be sanitized before they are treated as chemically reasonable.

Hydrogens are made explicit before 3D generation. RDKit documents that explicit hydrogens are important for realistic geometries. The service then runs ETKDGv3 with a fixed random seed, one thread, bounded iterations, and the same settings for every request. It applies MMFF94 only when RDKit reports complete MMFF parameters. If MMFF parameters are incomplete, UFF is used only when RDKit reports complete UFF parameters. If neither parameter set is complete, the ETKDGv3 conformer is returned with an explicit warning and no force-field minimization.

Coordinates in `atoms` and bond lengths in `bonds` are in ångström. They describe one generated conformer. They must not be interpreted as measured bond lengths, an exhaustive conformer search, a global minimum, a transition state, or a quantum-chemical result. A fixed seed makes repeated supported requests reproducible on the pinned RDKit build; it does not make the conformer uniquely correct.

The `molblock` and `svg` are separate 2D depictions generated from the sanitized heavy-atom molecule. Molecular formula, average molecular weight, H-bond donor/acceptor counts, Crippen logP, and TPSA are RDKit descriptors.

## Local VSEPR labels

VSEPR is reported per heavy atom, using bonded neighbors as bonding domains; a multiple bond counts as one domain. The classifier covers neutral main-group patterns where a local electron-domain model is useful:

- neutral tetrahedral carbon (`AX4`), trigonal-planar carbon including a carbonyl carbon (`AX3`), and linear carbon (`AX2`);
- neutral amine/ammonia nitrogen (`AX3E`) and selected two-coordinate nitrogen patterns;
- two-coordinate neutral oxygen, including water (`AX2E2`);
- a small set of analogous neutral B, Si, P, S, As, and Se patterns where the local rule is unambiguous.

Water is labeled bent with tetrahedral electron geometry and an educational reference angle of about 104.5°. Ammonia is labeled trigonal pyramidal with tetrahedral electron geometry and an angle of about 107°. OpenStax explains that ammonia has one lone pair and three bonds in a tetrahedral electron arrangement, and that the molecular shape is trigonal pyramidal with an H-N-H angle below the ideal 109.5°.

The classifier returns `supported: false` with a reason for terminal atoms, radicals, charged centers, transition-metal centers, and resonance or hypervalent patterns outside these rules. This is deliberate abstention. A local Lewis/VSEPR rule is not a general coordination-chemistry or electronic-structure method.

## Educational spectrum regions

All returned spectrum peaks are schematic markers placed at the midpoint of a broad reference range. `intensity` only supports drawing a legible teaching graphic. It is not absorbance, transmittance, molar absorptivity, or an experimentally predicted relative intensity.

### IR

The IR rules recognize a limited set of SMARTS functional groups, including O-H, N-H, C-H, C=O, C=C, C≡N, and terminal alkyne environments. The ranges are based on the Chemistry LibreTexts IR absorption reference table. They do not model conjugation shifts, hydrogen bonding, phase, concentration, anharmonicity, peak width, or instrument response. An absent schematic band does not prove that a vibration is absent.

### ¹H and ¹³C NMR

The NMR rules assign each explicit hydrogen or carbon to a broad introductory chemical-shift region. Counts are numbers of matched atoms, not numbers of chemically distinct signals. The result does not infer symmetry/equivalence, splitting, coupling constants, exchange, integration, solvent, concentration, temperature, or stereochemical effects. The ¹³C ranges follow the broad carbon-environment intervals in the cited LibreTexts table, such as alkyl, heteroatom-bound, alkene/aromatic, acid-derivative carbonyl, aldehyde, and ketone regions.

### UV-Vis

UV-Vis is returned only as a conceptual region when a supported neutral, main-group conjugated or aromatic pi system is detected. The displayed band says that such chromophores commonly absorb in the near-UV/visible domain; it is not a predicted λmax. The API returns `supported: false` and no peak for molecules without a recognized conjugated chromophore, and for charged or transition-metal chromophores that require a more suitable electronic-structure method. Educational sources emphasize that UV-Vis is mainly informative for conjugated pi systems and that increased conjugation shifts absorption toward longer wavelengths.

## Anonymous endpoint bounds

`POST /api/molecule` accepts exactly one of `smiles`, `molblock`, or `graph`, plus an optional name. The name is Unicode-normalized, stripped of control and markup-sensitive characters, whitespace-collapsed, and limited to 80 characters before it is placed in the mol block. Requests are limited to 64 KiB, 2,048 SMILES characters or 50,000 mol-block characters, 96 graph/heavy atoms, 192 bonds, and 256 atoms after adding hydrogens. Graph coordinates must be finite and within ±10,000. Dot-disconnected salts and mixtures are rejected because independent fragments do not define one meaningful gas-phase geometry in this endpoint.

`GET /api/molecule` returns health and the active size limits. For local use, `python api/molecule.py` serves `http://127.0.0.1:8001/api/molecule`.

## Sources

- RDKit, [Getting Started with the RDKit in Python](https://www.rdkit.org/docs/GettingStartedInPython.html) — parsing, explicit hydrogens, ETKDGv3, MMFF, writing mol blocks, and descriptors.
- RDKit, [`rdkit.Chem.rdDistGeom` API](https://www.rdkit.org/docs/source/rdkit.Chem.rdDistGeom.html) — ETKDGv3, bounded embedding parameters, and fixed random seeds.
- RDKit, [`rdkit.Chem.rdmolfiles` API](https://www.rdkit.org/docs/source/rdkit.Chem.rdmolfiles.html) — strict mol-block parsing and sanitization options.
- OpenStax, [Chemistry: Atoms First 2e, Molecular Structure and Polarity](https://openstax.org/books/chemistry-atoms-first-2e/pages/4-6-molecular-structure-and-polarity) — electron-domain geometries and water/ammonia VSEPR examples.
- Chemistry LibreTexts, [Infrared Spectroscopy Absorption Table](https://chem.libretexts.org/Ancillary_Materials/Reference/Reference_Tables/Spectroscopic_Reference_Tables/Infrared_Spectroscopy_Absorption_Table) — introductory IR functional-group ranges.
- Chemistry LibreTexts, [Carbon-13 NMR](https://chem.libretexts.org/Bookshelves/Analytical_Chemistry/Instrumental_Analysis_%28LibreTexts%29/19%3A_Nuclear_Magnetic_Resonance_Spectroscopy/19.05%3A_Carbon-13_NMR) — broad ¹³C chemical-shift regions.
- Chemistry LibreTexts, [Structure Determination in Conjugated Systems: Ultraviolet Spectroscopy](https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Organic_Chemistry_II_%28Morsch_et_al.%29/14%3A_Conjugated_Compounds_and_Ultraviolet_Spectroscopy/14.07%3A_Structure_Determination_in_Conjugated_Systems_-_Ultraviolet_Spectroscopy) — the limited, conjugation-focused scope of UV-Vis structure information.
- Chemistry LibreTexts, [Interpreting Ultraviolet Spectra: The Effect of Conjugation](https://chem.libretexts.org/Courses/Smith_College/Organic_Chemistry_%28LibreTexts%29/14%3A_Conjugated_Compounds_and_Ultraviolet_Spectroscopy/14.09%3A_Interpreting_Ultraviolet_Spectra-_The_Effect_of_Conjugation) — longer-wavelength absorption with increasing conjugation.
