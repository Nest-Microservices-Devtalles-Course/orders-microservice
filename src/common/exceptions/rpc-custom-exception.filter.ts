import {ArgumentsHost, Catch, ExceptionFilter, RpcExceptionFilter, UnauthorizedException} from "@nestjs/common";
import {RpcException} from "@nestjs/microservices";
import {Observable, throwError} from "rxjs";

@Catch(RpcException)
export class RPCCustomExceptionFilter implements ExceptionFilter {
  catch(exception: RpcException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    const rpcError = exception.getError();

    if (typeof rpcError === 'object' && 'status' in rpcError && 'message' in rpcError) {
      const status = rpcError.status;
      return response.status(status).json(rpcError);
    }

    response.status(400).json({
      status: 400,
      message: rpcError
    });
  }
}