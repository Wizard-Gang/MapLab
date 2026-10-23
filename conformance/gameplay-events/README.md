# Owned gameplay authoring and Test-event fixtures (ML-024)

All data is original owned CC0-1.0, derived from the owned placeholder Forest
source set. Existing placeholder/conformance inputs remain unchanged. The copied
Forest adds the remaining closed F entity variants so all fifteen entity kinds
and every gameplay inspector collection have executable coverage.

The separate Test runtime evaluates full rectangular actor bodies against region
interiors. Tangency is outside. Rect and simple polygon sensors use continuous
separating-axis intervals (concave polygons are triangulated); circles use the
rounded-rectangle Minkowski sum. Time of impact is a float64 fraction along the
segment between successive post-collision foot positions. This is a declared Test
sensor interpolation, not a claim about an arbitrary engine's within-tick path.
Coordinates stay integer su; polygon projections and circle discriminants use
BigInt intermediates. Tick-zero spawn overlaps emit enter. Events sort by time,
then stable actor instance ID, trigger ID, and enter before exit for exact ties.
Conditions all observe the pre-action boundary snapshot. Actions retain authored
order and apply after all sensing; enabled-body effects change the next physics
tick. Actor categories are gameplay roles, independently of collision masks.

Only core.flag.set@1, core.body.set-enabled@1 and core.encounter.activate@1
have declarative Test handlers. Activation enables the named initially inactive
spawns once. A selected active encounter completes only by explicitly injecting
its declared catalog event. Completion actions update the runtime flags/gate;
combat, AI, waves, checkpoint effects and portal travel remain engine-owned,
configured, not simulated. Unsupported conditions do not pass. Unknown action
implementations are logged as configured and never executed. Wrong catalog kinds
and malformed references are rejected by closed source graph validation.

Overlap sets, one-shot completion, stable instance IDs, flags, enabled state and
encounter state exist only in runtime snapshots. Reset rebuilds them. Recorded
external event injections are bounded, ordered end-boundary data, replayed beside
controller inputs. No source history, file or catalog is mutated. Test budgets:
256 triggers, 64 actors, 256 vertices per polygon, 4096 aggregate region points,
3600 absolute ticks, 10000 sensor events/actions, and 100000 work units per
boundary (polygon vertex-count cubed per actor/trigger pair; 16 for other shapes); overflow publishes explicit
budget status without a partial tick. Inspector edits stage complete typed records
and commit atomically through normal source-graph validation/history.

cases.json owns five final-byte cases: fast enter/exit across a one-WU region,
spawn-inside/simultaneous actor/trigger ordering and once, circle and polygon
crossings, and Forest boss activation with explicit completion event injection.
Each expected file is a canonical complete runtime snapshot. index.json pins all
inputs, source files, this declaration and expected outputs.

The isolated Node standard-library consumer imports no MapLab code. It independently
uses expanded-rectangle slabs and nearest-point piecewise circle quadratics, checks
ordered boundary actions/flags/enabled spawns, explicit encounter completion and
final hashes. Its polygon oracle is intentionally restricted to the owned four-
corner rectangle case; concave and boundary geometry have additional unit tests.
A rehashed altered event time must fail semantic consumption, not only a hash check.
