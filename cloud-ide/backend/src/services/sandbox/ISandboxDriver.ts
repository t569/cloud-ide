import { InternalBootRequest, InternalBootResponse } from '../OpenSandboxRouter'; // Reusing your types!

export interface ISandboxDriver {
  bootContainer(request: InternalBootRequest): Promise<InternalBootResponse>;
  pauseSandbox(sandboxId: string): Promise<boolean>;
  destroySandbox(sandboxId: string): Promise<boolean>;
  getSandboxStatus(sandboxId: string): Promise<any>;
}