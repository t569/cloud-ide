// frontend/src/terminal/MiddlewarePipeline.ts

/* this file defines the interface for creating middleware
*  a middleware is basically a service that is run on input before it is sent to a backend stream 
* or a service that is run on output given from the backend stream
* for more info about our backend stream please check ./terminal/transport
*/ 

export interface IMiddleware {
    name: string;

    // Manipulates/processes data from backend/WASM before it hits the Ui
    processIncoming(data: string): string;

    // Manipulates/processes data coming from the UI before it hits the backend
    processOutgoing(data: string):string;

}

export class MiddlewarePipeline {
    // list of all or available middlewares
    private middlewares: IMiddleware[] = [];


    // Registers a new middleware plugin into the pipleine
    public use(middleware: IMiddleware):void{
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

}