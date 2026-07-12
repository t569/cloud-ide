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

    // The allow-list used to be so narrow it rejected most real package syntax — a Go
    // module path or a scoped npm package could not be installed AT ALL.
    it('accepts real package syntax that the old regex rejected', () => {
      const accepts = (type: 'apt' | 'npm' | 'pip' | 'go', packages: string[]) => {
        const config: EnvironmentConfig = {
          id: 'test', name: 'Test',
          // A base whose aliases satisfy the execution-order check for this manager.
          baseImage: type === 'pip' ? 'python:3.11' : type === 'npm' ? 'node:20' : type === 'go' ? 'golang:1.22' : 'ubuntu:22.04',
          buildSteps: [{ name: 'Deps', type, packages }],
        };
        expect(() => Validator.parseAndValidate(JSON.stringify(config))).not.toThrow();
      };

      accepts('go', ['github.com/gorilla/mux@v1.7.4']); // module path — needs `/`
      accepts('npm', ['@types/node@22.5.0']);           // scoped package — needs `/`
      accepts('pip', ['uvicorn[standard]']);            // extras — needs `[ ]`
      accepts('pip', ['numpy>=1.20,<2']);               // version range — needs `< > ,`
      accepts('pip', ['torch==2.0.0+cpu']);             // PEP 440 local version — needs `+`
    });

    // The widened list is only safe BECAUSE the specs are single-quoted into the RUN line.
    // A literal quote would break out of that, so it must stay rejected.
    it('still rejects anything that could escape the shell quoting', () => {
      for (const evil of ["git'; rm -rf /; '", 'curl `id`', 'pkg $(whoami)', 'a b', 'pkg\nrm -rf /']) {
        const config: EnvironmentConfig = {
          id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
          buildSteps: [{ name: 'Hacker Step', type: 'apt', packages: [evil] }],
        };
        expect(() => Validator.parseAndValidate(JSON.stringify(config))).toThrow(/Security Violation/);
      }
    });

    it('names the step in the error when the step has no name', () => {
      const config: EnvironmentConfig = {
        id: 'test', name: 'Test', baseImage: 'ubuntu:22.04',
        buildSteps: [{ name: '', type: 'apt', packages: ['bad name'] }],
      };
      // "in step ''" told the user nothing about which step to go fix.
      expect(() => Validator.parseAndValidate(JSON.stringify(config))).toThrow(/apt step at index 0/);
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