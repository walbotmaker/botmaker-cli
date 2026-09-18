// The shape `bmc run --json` prints. It is the contract a script or a coding
// agent reads, so nothing here is translated and nothing here does IO.

const ErrorKind = Object.freeze({
  COMPILE: 'COMPILE',
  RUNTIME: 'RUNTIME',
  USAGE: 'USAGE',
});

// `code` stays in English on purpose: `message` may come translated, so the
// code is the only part a caller can safely match on.
const compileError = (message, diagnostics) => {
  const error = { kind: ErrorKind.COMPILE, code: 'TS_COMPILE_FAILED', message: String(message || '') };
  if (diagnostics && diagnostics.length > 0) error.diagnostics = diagnostics;
  return error;
};

const runtimeError = (message, stack, code = 'CA_THREW') => {
  const error = { kind: ErrorKind.RUNTIME, code, message: String(message || '') };
  if (stack) error.stack = String(stack);
  return error;
};

const usageError = (code, message) => ({
  kind: ErrorKind.USAGE,
  code,
  message: String(message || ''),
});

const buildEnvelope = (input = {}) => {
  const { type, name, durationMs, inputSchema, logs, error, flow } = input;
  const envelope = { ok: !error };
  if (type) envelope.type = type;
  if (name) envelope.name = name;
  if (typeof durationMs === 'number') envelope.durationMs = durationMs;
  // A client action that returns nothing still returned: say null, don't hide
  // the key and leave the caller guessing whether the run even got that far.
  if ('result' in input) envelope.result = input.result === undefined ? null : input.result;
  if (inputSchema) envelope.inputSchema = inputSchema;
  if (flow) {
    for (const key of ['action', 'screen', 'nextScreen', 'data', 'flowState']) {
      if (flow[key] !== undefined && flow[key] !== null) envelope[key] = flow[key];
    }
  }
  envelope.logs = logs || [];
  if (error) envelope.error = error;
  return envelope;
};

const exitCodeFor = (envelope) => (envelope && envelope.ok ? 0 : 1);

// A client action can return something JSON cannot hold, like an object that
// points at itself. Printing nothing would look like a crash, so we turn it
// into a failure the caller can read.
const renderJson = (envelope) => {
  try {
    return JSON.stringify(envelope, null, 2);
  } catch (err) {
    const fallback = buildEnvelope({
      type: envelope.type,
      name: envelope.name,
      durationMs: envelope.durationMs,
      logs: envelope.logs,
      error: {
        kind: ErrorKind.RUNTIME,
        code: 'RESULT_NOT_SERIALIZABLE',
        message: `The client action returned something that cannot be turned into JSON: ${err.message}`,
      },
    });
    return JSON.stringify(fallback, null, 2);
  }
};

module.exports = {
  ErrorKind,
  buildEnvelope,
  exitCodeFor,
  renderJson,
  compileError,
  runtimeError,
  usageError,
};
