import { InternalBootRequest, InternalBootResponse } from '../OpenSandboxRouter'; // Reusing your types!

// DEPRECIATED: we are using rust for this now
export interface ISandboxDriver {
  bootContainer(request: InternalBootRequest): Promise<InternalBootResponse>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  getSandboxStatus(sandboxId: string): Promise<any>;
}