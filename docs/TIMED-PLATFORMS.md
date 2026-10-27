# Periodic platform navigation

Navigation mode includes a periodic-platform route panel. Enter a grounded start
pose and absolute tick, select a goal support, and search wait/board/ride/exit
transitions. Walking and ground jumping are optional control samples. The panel
can replay the full witness through Test and exercise phase feedback.

`planTimedPlatforms` in `src/platforms/navigation.ts` searches explicit integer
clock/contact/velocity/resource states with nonnegative one-tick costs. Both A*
and Dijkstra use zero heuristic. Each transition calls the translating-platform
runtime, including finite-body sweeps, clipped carries, departure velocity and
crush refusal. Successful routes are replayed from their unchanged initial state.

Standing safe intervals use support-local endpoint and midpoint samples at every
tick in the declared horizon. They describe body clearance at those samples;
only a swept runtime transition authorizes movement. Static surface/airborne
graphs continue to refuse enabled moving bodies and cannot certify a rendezvous.

The default horizon is 120 ticks, with 4,096 expansions, 40,000 control samples,
50,000 replay ticks and 200,000 standing samples. Hard maxima are 600 ticks,
20,000 expansions, 200,000 controls, 1,000,000 replay ticks and 2,000,000 standing
samples. Exhaustion returns a qualified failure without partial witness frames.

Only periodic linear loop/pingPong translation and the basic ground-jump profile
are supported. Once/aperiodic motion, advanced abilities, traversal, authored
links/conditions, directional supports and navigation overrides require another
solver. No completeness, future blocker state or external engine parity is claimed.

Before following each tick, call `followTimed` with the complete actor state and
measured platform phases at that absolute tick. Phase feedback includes body IDs,
period, phase tick and offset, so repeated positions do not erase phase drift.
A changed clock, contact, velocity, body set or phase requests replanning. The
engine must obtain fresh feedback and invoke the bounded planner again.
