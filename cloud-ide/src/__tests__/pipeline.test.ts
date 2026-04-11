// __tests__/pipeline.test.ts

import { Validator } from '../shared/utils/Validator';
import { StageOrchestrator } from '../pipeline/StageOrchestrator';
import { DockerfileAssembler } from '../pipeline/assembler/DockerfileAssembler';
import { EnvironmentConfig } from '../shared/types/env';

describe('Cloud IDE Pipeline Edge Cases', () => {

  describe('Phase 1: Validator Edge Cases', () => {
    it('should catch trailing slash path collisions', () => {
      const config: EnvironmentConfig = {
        id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
        buildSteps: [
          // Changed to 'shell' to avoid triggering the Execution Order dependency checks
          { name: 'Step 1', type: 'shell', targetPath: '/app', command: 'echo "hello"' },
          { name: 'Step 2', type: 'shell', targetPath: '/app/', command: 'echo "world"' } 
        ]
      };

      expect(() => Validator.parseAndValidate(JSON.stringify(config)))
        .toThrow(/Path Conflict/);
    });

    it('should prevent shell injection in package names', () => {
      const config: EnvironmentConfig = {
        id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
        buildSteps: [{ name: 'Hacker Step', type: 'apt', packages: ['curl', 'git; rm -rf /'] }]
      };

      expect(() => Validator.parseAndValidate(JSON.stringify(config)))
        .toThrow(/Security Violation/);
    });
  });

  describe('Phase 2: Orchestrator Edge Cases', () => {
    it('should use single-stage bypass if no compiler steps exist', () => {
      const config: EnvironmentConfig = {
        id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
        buildSteps: [
          { name: 'Just APT', type: 'apt', packages: ['curl'] }
        ]
      };

      const manifest = StageOrchestrator.generateManifest(config);
      
      expect(manifest.stages.length).toBe(1); // No builder stage generated
      expect(manifest.stages[0].role).toBe('runtime');
    });
  });

  describe('Phase 4: Assembler & Context Manager Edge Cases', () => {
    it('should accurately track and switch directories (Directory Hopping)', () => {
      const config: EnvironmentConfig = {
        id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
        buildSteps: [
          { name: 'API setup', type: 'pip', targetPath: '/api', packages: ['fastapi'], isGlobal: false },
          { name: 'Web setup', type: 'npm', targetPath: '/web', packages: ['react'], isGlobal: false },
          { name: 'API script', type: 'shell', targetPath: '/api', command: 'echo "done"' }
        ]
      };

      const manifest = StageOrchestrator.generateManifest(config);
      const assembler = new DockerfileAssembler(manifest);
      const dockerfile = assembler.assemble();

      // It should switch to /api, then /web, then BACK to /api
      const workdirMatches = dockerfile.match(/WORKDIR/g);
      expect(workdirMatches?.length).toBe(3);
    });
  });
});