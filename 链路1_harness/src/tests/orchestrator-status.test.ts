import assert from "node:assert/strict";
import test from "node:test";

import { chain1ReadyStatus } from "../orchestrator.js";

test("declares every partial chain1 path as ready_with_fallbacks", () => {
  assert.equal(chain1ReadyStatus(1, 0, 0), "ready_with_fallbacks");
  assert.equal(chain1ReadyStatus(0, 1, 0), "ready_with_fallbacks");
  assert.equal(chain1ReadyStatus(0, 0, 1), "ready_with_fallbacks");
  assert.equal(chain1ReadyStatus(0, 0, 0, 1), "ready_with_fallbacks");
  assert.equal(chain1ReadyStatus(0, 0, 0), "ready");
});
