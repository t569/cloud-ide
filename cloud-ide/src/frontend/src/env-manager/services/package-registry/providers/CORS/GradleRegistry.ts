// src/components/env-manager/services/package-registry/providers/GradleRegistry.ts

import { MavenRegistry } from "./MavenRegistry";

export class GradleRegistry extends MavenRegistry {
  constructor() {
    super('gradle'); // Reuses Maven logic but tags results as 'gradle'
  }
}