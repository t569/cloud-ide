import { BuildStep } from '../types/env';

// export interface PackageManagerRule {
//   watchFiles: string[]; // Files the SyncDaemon should track
//   compileDocker: (step: BuildStep) => string; // The mini-compiler for DockerGenerator
//   installCommand: (packages: string[], isGlobal?:boolean) => string;  // this is to be run while the container is still active
//   flags?: string []; // this is used to determinr the various commands we will use
// }

export interface PackageManagerRule {
  watchFiles: string[];
  installCommand: (packages: string[], isGlobal?: boolean, version?: string) => string;

  // this is used to generate the docker command with the right build command
  getBuildCommand: (step: BuildStep, flags?: string[]) => string;
}




///  ---------------------------------------- FLAGS ----------------------------------------
// buildkit: used for caching with docker builder kit
// this section defines all the various flags we will use to determine the various package managers, and their respective rules for installation, docker compilation, and file watching
const useBuildKit = (flags?: string[]) => flags?.includes('--use-buildkit') || flags?.includes('buildkit')|| false;





// The master dictionary for our language/package environments

// we can add cargo, and various other package rules
// also remember to add it to InstallStepType in env.ts

export const PackageManagerRules: Record<string, PackageManagerRule> = {
  
  // APT PACKAGES
   apt: {
    watchFiles: [],
    installCommand: (pkgs) => `apt-get update && apt-get install -y --no-install-recommends ${pkgs.join(' ')} && rm -rf /var/lib/apt/lists*`,
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) 
        ? `--mount=type=cache,target=/var/cache/apt,sharing=locked --mount=type=cache,target=/var/lib/apt,sharing=locked ` 
        : '';
      const base = this.installCommand(step.packages || []);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

  // NPM PACKAGES
  npm: {
    watchFiles: ['package.json', 'package-lock.json'],
    installCommand: (pkgs, isGlobal, version) => {
      const prefix = version ? `npx -p node@${version} ` : '';
      const pkgString = pkgs.join(' ');
      return `${prefix}npm install ${isGlobal ? '-g' : ''} ${pkgString}`.trim();
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) ? `--mount=type=cache,target=/root/.npm,sharing=locked ` : '';
      const base = this.installCommand(step.packages || [], step.isGlobal, step.version);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },


  // PIP PACKAGES
  pip: {
    watchFiles: ['requirements.txt', 'Pipfile', 'pyproject.toml'],
    installCommand: (pkgs, isGlobal, version) => {
      const python = version ? `python${version}` : 'python3';
      const pkgString = pkgs.join(' ');
      return isGlobal 
        ? `${python} -m pip install ${pkgString} --break-system-packages`
        : `${python} -m venv .venv && ./.venv/bin/pip install ${pkgString}`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) ? `--mount=type=cache,target=/root/.cache/pip,sharing=locked ` : '';
      const base = this.installCommand(step.packages || [], step.isGlobal, step.version);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

  // RUST/CARGO PACKAGES
  cargo: {
    watchFiles: ['Cargo.toml', 'Cargo.lock'],
    installCommand: (pkgs, _, version) => {
      const toolchain = version ? `+${version} ` : '';
      return pkgs.length ? `cargo ${toolchain}install ${pkgs.join(' ')}` : `cargo ${toolchain}build --release`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) 
        ? `--mount=type=cache,target=/usr/local/cargo/registry/ --mount=type=cache,target=/app/target/ ` 
        : '';
      const base = this.installCommand(step.packages || [], false, step.version);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

  // GO PACKAGES
  go: {
    watchFiles: ['go.mod', 'go.sum'],
    installCommand: (pkgs, _, version) => {
      const goBin = version ? `go${version}` : 'go';
      return pkgs.length ? `${goBin} get ${pkgs.join(' ')}` : `${goBin} build -o app`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) 
        ? `--mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build ` 
        : '';
      const base = this.installCommand(step.packages || [], false, step.version);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

  // ZIG PACKAGES
  zig: {
    watchFiles: ['build.zig', 'build.zig.zon'],
    installCommand: (pkgs, _, version) => {
      const zigBin = version ? `zig-${version}` : 'zig';
      return pkgs.length ? `${zigBin} fetch --save ${pkgs.join(' ')}` : `${zigBin} build -Doptimize=ReleaseSafe`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) 
        ? `--mount=type=cache,target=/root/.cache/zig,sharing=locked --mount=type=cache,target=/app/zig-out,sharing=locked ` 
        : '';
      const base = this.installCommand(step.packages || [], false, step.version);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

    // RUBY PACKAGES
  ruby: {
    watchFiles: ['Gemfile', 'Gemfile.lock'],
    installCommand: (pkgs, isGlobal, version) => {
      // If version is provided, we use 'rbenv exec' or 'rvm' style switching
      // Otherwise, we default to standard gem/bundle
      const prefix = version ? `rbenv shell ${version} && ` : '';
      const pkgString = pkgs.join(' ');
      
      return pkgs.length 
        ? `${prefix}gem install ${isGlobal ? '' : '--no-user-install'} ${pkgString}`
        : `${prefix}bundle install`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) 
        ? `--mount=type=cache,target=/usr/local/bundle/cache,sharing=locked ` 
        : '';
      
      // Call the base installCommand with metadata
      const base = this.installCommand(step.packages || [], step.isGlobal, step.version);
      const cmd = `${cache}${base}`;
      
      // Wrap in directory isolation if targetPath exists
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },


  // JAVA/MAVEN PACKAGES
  maven: {
    watchFiles: ['pom.xml'],
    installCommand: (pkgs, _, version) => {
      // Maven usually uses a wrapper or system mvn; version can be passed as a system property
      return `mvn clean package -DskipTests`;
    },
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) ? `--mount=type=cache,target=/root/.m2,sharing=locked ` : '';
      const base = this.installCommand(step.packages || []);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },

  // JAVA/GRADLE PACKAGES
   gradle: {
    watchFiles: ['build.gradle', 'settings.gradle'],
    installCommand: () => `./gradlew build -x test`,
    getBuildCommand(step, flags) {
      const cache = useBuildKit(flags) ? `--mount=type=cache,target=/root/.gradle,sharing=locked ` : '';
      const base = this.installCommand([], false);
      const cmd = `${cache}${base}`;
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  },




  // SHELL COMMANDS - this is for custom shell commands that the user can specify, we will just run them as is, and we wont do any caching for these since we have no insight into what they are doing
  shell: {
    watchFiles: [],
    installCommand: (pkgs) => pkgs.join(' '), // If packages are used as command parts; largely unused for shell type, but we keep it for consistency
    getBuildCommand: (step) => {
      const cmd = step.command || '';
      return step.targetPath ? `cd ${step.targetPath} && ${cmd}` : cmd;
    }
  }

}
