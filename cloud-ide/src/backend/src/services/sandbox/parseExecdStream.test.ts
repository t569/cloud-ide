// The bodies below are VERBATIM from a live execd (opensandbox/execd:v1.0.6), captured by
// POSTing /command through the daemon's endpoint proxy. The old parser required an SSE
// `data: ` prefix that execd does not send, so it skipped every event and returned
// `{stdout: '', stderr: '', exitCode: 0}` — a silent "success with no output" for every
// exec. That is what made files outside /workspace open blank, and what made a failed read
// look like an empty file instead of a 404.
import { parseExecdStream } from './openSandboxEngine';

const SUCCESS = [
  '{"type":"init","text":"712b4095f76b4837a95661ea561f034a","timestamp":1784016323627}',
  '',
  '{"type":"ping","text":"pong","timestamp":1784016323628}',
  '',
  '{"type":"stdout","text":"NAME=\\"Alpine Linux\\"","timestamp":1784016323632}',
  '',
  '{"type":"stdout","text":"ID=alpine","timestamp":1784016323632}',
  '',
  '{"type":"execution_complete","execution_time":6,"timestamp":1784016323633}',
].join('\n');

const FAILURE = [
  '{"type":"init","text":"ec552f64a9b34763a29c5eebfab7276d","timestamp":1784016363918}',
  '',
  '{"type":"stderr","text":"cat: can\'t open \'/nope/missing\': No such file or directory","timestamp":1784016363923}',
  '',
  '{"type":"error","timestamp":1784016363923,"error":{"ename":"CommandExecError","evalue":"1","traceback":["exit status 1"]}}',
].join('\n');

describe('parseExecdStream', () => {
  it('reassembles stdout with its newlines', () => {
    const { stdout, exitCode } = parseExecdStream(SUCCESS);

    // Each event is one line with the trailing newline stripped. Concatenating the raw
    // `text` fields ran the whole file together into a single line.
    expect(stdout).toBe('NAME="Alpine Linux"\nID=alpine\n');
    expect(exitCode).toBe(0);
  });

  it('reports the exit code from the error event', () => {
    const { stderr, exitCode } = parseExecdStream(FAILURE);

    // `type: "error"` with the status in error.evalue — there is no `type: "result"`.
    // Without this, readExternalFile's `if (exitCode !== 0) throw` never fired and a
    // missing file came back as 200 with empty content.
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cat: can't open '/nope/missing'");
  });

  it('treats a malformed error event as a failure, never a success', () => {
    const body = '{"type":"error","error":{"ename":"CommandExecError"}}';
    expect(parseExecdStream(body).exitCode).toBe(1);
  });

  it('still accepts SSE-framed events', () => {
    const body = 'data: {"type":"stdout","text":"hi"}\ndata: {"type":"result","exitCode":3}';
    expect(parseExecdStream(body)).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 3 });
  });
});
