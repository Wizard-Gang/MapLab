// Independent process boundary for the ML-005 profile contract only; no bundle or engine claim.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadMovement, movementProfileDigest, movementProfileJcs } from './src/contracts/index.js';
const checked = loadMovement(readFileSync(process.argv[2]));
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
const profileSha256 = await movementProfileDigest(checked.document);
if (profileSha256 !== createHash('sha256').update(movementProfileJcs(checked.document)).digest('hex')) throw new Error('Digest consumer mismatch');
console.log(JSON.stringify({ id: checked.document.id, profileSha256, unsupported: checked.compatibility.diagnostics, canCertify: checked.compatibility.canCertify }));
