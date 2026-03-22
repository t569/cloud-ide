// shared/utils/optimise.ts

// this defines optimsation functions for our docker builder
import { BuildStep } from "../types/env";


export function injectCacheBuster(force: boolean) : string {
    return force ? `\n# --- CACHE BYPASS: ${Date.now()} --\n`: '';
}

// this flattens our image by grouping multiple common installs e.g. apt into one install sweep
export function optimizeLayers(steps: BuildStep[]): BuildStep[] {
    const optimized:BuildStep [] = [];
    for (const step of steps) {

        const last = optimized[optimized.length - 1];

        // Only group if they are the same type and have the same targetPath
        // TODO: we can make this more complex to group same install packages
        if (last && last.type === step.type && last.targetPath === step.targetPath && step.type !== 'shell') {
            last.packages = [...(last.packages || []), ...(step.packages || [])];
            last.name = `${last.name} + ${step.name}`;
        } else {
            optimized.push({ ...step });
        }
    }

    return optimized;
}

