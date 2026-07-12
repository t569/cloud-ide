// The RUN line is where a package spec meets a shell. These pin the quoting that lets the
// Validator's allow-list be wide enough for real ecosystems without opening an injection.
import { PackageManagerRules, joinPackages } from './packagemanager_rules';

describe('joinPackages', () => {
  it('single-quotes every spec so shell metacharacters cannot act', () => {
    // Unquoted, `>` redirects to a file called "=1.20,<2" and the install silently
    // installs the wrong thing (or nothing).
    expect(joinPackages(['numpy>=1.20,<2'])).toBe("'numpy>=1.20,<2'");
    expect(joinPackages(['uvicorn[standard]', 'requests'])).toBe("'uvicorn[standard]' 'requests'");
  });
});

describe('install commands', () => {
  it('quotes packages for every manager', () => {
    expect(PackageManagerRules.apt.installCommand(['libpq-dev'])).toContain("'libpq-dev'");
    expect(PackageManagerRules.pip.installCommand(['numpy>=1.20,<2'], true)).toContain("'numpy>=1.20,<2'");
    expect(PackageManagerRules.npm.installCommand(['@types/node'], true)).toContain("'@types/node'");
  });

  it('gives go a module before `go get`, which cannot run without one', () => {
    const cmd = PackageManagerRules.go.installCommand(['github.com/gorilla/mux@v1.7.4']);
    // Without this, an image build with no go.mod dies on
    // "go.mod file not found in current directory".
    expect(cmd).toMatch(/go mod init/);
    expect(cmd).toContain("'github.com/gorilla/mux@v1.7.4'");
  });
});
