// Concurrency contract for the queue / relay / Semaphore path — the most
// intricate logic here. A fake builder hands back controllable build handles so
// we can hold a slot open, then assert queued->building->done, cancel-while-
// queued, and slot release on failure. generateDockerfile is stubbed: this
// tests the queue, not the pipeline.
import { EventEmitter } from 'events';
import { BuildService } from './BuildService';
import { BuilderRegistry } from './BuilderRegistry';
import { InMemoryBuildStore } from './BuildStore';
import { IBuilder, BuildProcess } from './IBuilder';
import { DockerGeneratorService } from './GeneratorService';
import { EnvironmentRecord } from '../../database/models';

class FakeBuild extends EventEmitter implements BuildProcess {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
    this.emit('failed', 'Build cancelled');
  }
  succeed(msg = 'ok'): void {
    this.emit('succeeded', msg);
  }
  failWith(msg = 'boom'): void {
    this.emit('failed', msg);
  }
}

class FakeBuilder implements IBuilder {
  readonly name = 'docker';
  readonly builds: FakeBuild[] = [];
  build(): BuildProcess {
    const b = new FakeBuild();
    this.builds.push(b);
    return b;
  }
}

const env = (id: string) => ({ id }) as EnvironmentRecord;
const tick = () => new Promise((r) => setImmediate(r)); // flush queue microtasks

describe('BuildService concurrency', () => {
  let builder: FakeBuilder;
  let store: InMemoryBuildStore;
  let svc: BuildService;

  beforeEach(() => {
    jest.spyOn(DockerGeneratorService, 'generateDockerfile').mockReturnValue('FROM scratch');
    builder = new FakeBuilder();
    store = new InMemoryBuildStore();
    svc = new BuildService(new BuilderRegistry([builder]), store, 1); // maxConcurrent = 1
  });
  afterEach(() => jest.restoreAllMocks());

  it('queued -> building -> succeeded', async () => {
    await svc.start(env('a'));
    await tick();
    expect(builder.builds).toHaveLength(1);
    expect(store.get('a')?.status).toBe('building');

    builder.builds[0].succeed('done');
    expect(store.get('a')?.status).toBe('succeeded');
  });

  it('cancel-while-queued fails the waiter without ever building it', async () => {
    await svc.start(env('a')); // takes the only slot
    await tick();
    await svc.start(env('b')); // queued behind a
    await tick();
    expect(builder.builds).toHaveLength(1); // b not built yet
    expect(store.get('b')?.status).toBe('queued');

    expect(svc.cancel('b')).toBe(true);
    expect(store.get('b')?.status).toBe('failed');
    expect(store.get('b')?.error).toBe('Build cancelled');

    // a completing must not resurrect b's build (its slot is returned unused).
    builder.builds[0].succeed();
    await tick();
    expect(builder.builds).toHaveLength(1);
  });

  it('releases the slot on failure so the next queued build runs', async () => {
    await svc.start(env('a'));
    await tick();
    await svc.start(env('b')); // queued
    await tick();
    expect(builder.builds).toHaveLength(1);

    builder.builds[0].failWith('boom'); // a fails -> slot freed
    await tick();
    expect(store.get('a')?.status).toBe('failed');
    expect(builder.builds).toHaveLength(2); // b now building
    expect(store.get('b')?.status).toBe('building');
  });
});
