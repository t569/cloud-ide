// Maps a builder name -> IBuilder so the build backend is swappable/config-driven.
// Register more (BuildKit, Kaniko, a remote build farm) without touching callers.
import { IBuilder } from './IBuilder';

export class BuilderRegistry {
  private readonly builders = new Map<string, IBuilder>();
  private readonly defaultName: string;

  constructor(builders: IBuilder[], defaultName?: string) {
    if (builders.length === 0) throw new Error('BuilderRegistry needs at least one builder');
    for (const b of builders) this.builders.set(b.name, b);
    this.defaultName = defaultName ?? builders[0].name;
  }

  get(name?: string): IBuilder {
    const key = name ?? this.defaultName;
    const builder = this.builders.get(key);
    if (!builder) throw new Error(`Unknown builder: "${key}"`);
    return builder;
  }
}
