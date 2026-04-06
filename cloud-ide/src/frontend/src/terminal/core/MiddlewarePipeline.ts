// frontend/src/terminal/MiddlewarePipeline.ts

/* this file defines the interface for creating middleware
*  a middleware is basically a service that is run on input before it is sent to a backend stream 
* or a service that is run on output given from the backend stream
* for more info about our backend stream please check ./terminal/transport
*/ 

import { ITerminalMiddleware } from "../types/terminal";

export class MiddlewarePipeline implements ITerminalMiddleware{

    name = 'CoreMiddlewarePipeline';

    // list of all or available middlewares
    private middlewares: ITerminalMiddleware[] = [];


    // Registers a new middleware plugin into the pipleine
    public use(middleware: ITerminalMiddleware):void{
        this.middlewares.push(middleware);
    }

    // Runs our incoming data through all registered middlewares sequetially
    public processIncoming(data:string):string {
        return this.middlewares.reduce((currentData, mw) => mw.processIncoming(currentData), data);
    }

    // Runs our outgoing data through all regsitered middlewares sequentially
    public processOutgoing(data: string): string {
        return this.middlewares.reduce((currentData, mw) => mw.processOutgoing(currentData), data);
    }

    public clear(): void {
        this.middlewares = [];
    }
}