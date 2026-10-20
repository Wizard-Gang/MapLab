# Owned jump/fall/drop reference fixtures (ML-018)

All data is original MapLab CC0-1.0 material. `index.json` pins every final file
except itself. `cases.json` lists the executable fixtures; each names its complete
map, movement profile, initial locomotion state, absolute run-length inputs and
exact tick checkpoints. Each companion `.trace.json` is the published canonical
reference trace plus one newline. No tolerance is applied to reference replay.

The trace envelope remains `maplab.contact-replay`, version 1, with
`scope: "jump-fall-drop"`, `canCertify: false`, controller and collision v1,
source/profile SHA-256 and a SHA-256 over canonical trace bytes excluding
`traceSha256`. Arrays retain semantic order, keys sort by code-unit order.
`frames` includes status, state and ordered contacts at every tick; failed frames
retain the old state and terminate replay. A resumed run uses the complete saved
state and a schedule beginning at that state's absolute tick. The envelope's
initial state/schedule differ, while resumed frame bytes match the original tail.

`LocomotionState` extends the ML-017 contact state with `jumpHeldPrev`,
`jumpReleased`, `ticksSinceJump`, `dropSuppression` and zeroed resources
`{airJumps:0,dashCharges:0,cooldowns:{}}`. All fields and both boolean `jump` and
`drop` controls are required together. `jumpReleased` latches the first rising
release for that takeoff; re-pressing cannot repeat the release cut. Hold gravity still follows the
sampled button while rising within `holdTicks`, as required by RC4. A fresh ground jump clears the latch. `ticksSinceJump` counts
completed airborne ticks and resets on landing. Absent jump ability refuses
jump; profiles enabling extra jumps or other ability solvers return unsupported.
The fixed profile uses the R1 player's dimensions and jump coefficients, omitting
the unimplemented climb ability explicitly. This is no full-player parity claim.

Tick order: validate → fresh ground jump (priority over drop), or permitted
one-way drop → air/ground horizontal velocity → finite X sweep → finite Y sweep
→ gravity, then first-release truncation, then fall cap → suppression decrement
and clearance → facing/plane → tick advance. No coyote/buffer/auto-jump exists.
Rising motion passes one-way faces, including lateral entry while rising.
Non-rising one-way landing requires the old foot at or above the face and a
full compatible footprint at the new X. Partial solid floors still block descent
while the stance is airborne, until the finite body clears the edge.

Only one-way faces in the selected `dropGroupId` are suppressed; no solid body
face is removed. Other groups, including a platform 16 WU below, can land the
body immediately. The timer decrements on the activation tick. Suppression clears
when the full rect top is strictly below all eligible selected-group segments
under its X span (or its X span leaves that group), or at timeout. Clearance uses
body-translated face geometry and the lowest height under the overlapping span.
Landing on a nearby lower group does not prematurely clear suppression. A solid
floor, disallowed one-way or disabled profile drop leaves the body grounded.

Contacts retain exact source identities, unnormalized normals and face witnesses.
Locomotion contacts additionally publish `pose:{x,y}` at the resolved axis stage:
an X witness is bounded by that finite rect even when later Y movement carries
the body away. Body-relative and physical-face witness bounds remain ≤1 su.
Legacy contact state/input uses `scope:"contact"`; all ML-017 final bytes remain
unchanged. There is no navigation certification or ML-019 traversal implementation.

The independent equations assert rise after n ticks =
`n*2112 - 96*n*(n-1)/2` su, apex 94.875 WU at ticks 22/23, and landing at tick 45.
The tiny forest-gap fixture takes off at x=480 and lands at x=660 (`fh.east`).
The unchanged R1 forest source has its west edge at x=480. With the preserved
24-WU full-footprint stance, the last valid grounded takeoff there is x=468;
`forest-source-ground-gap` lands at x=648 on tick 45. R1 RC6 calls its x=480
numbers a throwaway QA sketch and assigns exact windows to ML-018: we do not
relax the finite stance to treat an edge-centered body as grounded. The source
forest early jump from x=400 falls into the pit; the 144-WU elevated target
remains unreachable from the ground under this single-jump profile.

The matrix covers fixed/variable arcs, early/one-time release, reachable and
blocked gaps, impossible high target, low ceiling, finite flank wall, edge fall,
upward pass, downward landing, crossing refusal, same-group suppression, nearby
lower landing, body-clear rearm, jump back to restored upper group, timeout,
solid/disallowed drop refusal, no jump/air jump/automatic repeat and ground rearm.
Tests consume final bytes in an isolated Node process, check resume/repeat and
resources/support IDs, and run the same module in Chromium and WebKit.
