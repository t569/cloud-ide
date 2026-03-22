// shared/utils/secrets.ts

// this is the injector for secrets we need to build our image at boot time

export function wrapWithGitHubSecrets(command: string, useToken: boolean): string {
    if (!useToken) return `RUN ${command}\n`;
    // Mounts the secret to /run/secrets/gh_token during build only
    return `RUN --mount=type=secret,id=gh_token \\
    export GITHUB_TOKEN=$(cat /run/secrets/gh_token) && \\
    ${command}\n`;
  }

  /**
   * When we build the image, we pass the secrets to docker
   * 
   * From an evnironement variable (safest) 
   * Bash:
   * export MY_TOKEN=your_actual_github_token_here
   * docker build --secret id=gh_token,env=MY_TOKEN -t my-app .
   * 
   * 
   * From a local file
   * Bash:
   * # Save your token to a temporary file (do not commit this file!)
   * echo "your_actual_github_token_here" > token.txt
   * docker build --secret id=gh_token,src=token.txt -t my-app .
   * 
   */