import {HttpStatus, Inject, Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {CreateOrderDto} from './dto';
import {OrderStatus, PrismaClient} from "@prisma/client";
import {ClientProxy, RpcException} from "@nestjs/microservices";
import {OrderPaginationDto} from "./dto/order-pagination.dto";
import {ChangeOrderStatusDto, PaidOrderDto} from "./dto";
import {NATS_SERVICE} from "../config";
import {firstValueFrom} from "rxjs";
import {OrderWithProductsInterface} from "./dto/interfaces/order-with-products.interface";

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected!');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const productIds = createOrderDto.items.map(product => product.productId);
      const products = await firstValueFrom(this.client.send({cmd: 'validate_products'}, productIds));

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(product => product.id === orderItem.productId).price;
        return price * orderItem.quantity;
      }, 0);
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
          data: {
            totalItems,
            totalAmount,
            OrderItem: {
              createMany: {
                data: createOrderDto.items.map(orderItem => ({
                  price: products.find(product => product.id === orderItem.productId).price,
                  productId: orderItem.productId,
                  quantity: orderItem.quantity
                }))
              }
            }
          },
          include: {
            OrderItem: {
              select: {
                price: true,
                quantity: true,
                productId: true
              }
            }
          }
        }
      );

      return {
        ...order,
        OrderItem: order.OrderItem.map(orderItem => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };
    } catch (error) {
      console.log("error", error);
      throw new RpcException(error);
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: {id},
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true
          }
        }
      }
    });
    /*const products = await this.orderItem.findMany({
      where: {orderId: order.id}
    });*/

    if (!order) {
      throw new RpcException({status: HttpStatus.NOT_FOUND, message: `Order with ID not found`});
    }

    const productIds = order.OrderItem.map(orderItem => orderItem.productId);
    const products = await firstValueFrom(
      this.client.send({cmd: 'validate_products'}, productIds)
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map(orderItem => ({
        ...orderItem,
        name: products.find(product => product.id === orderItem.productId).name
      }))
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const {id, status} = changeOrderStatusDto;

    const order = await this.findOne(id);

    if (order.status === status) {
      return order;
    }

    return this.order.update({
      where: {id},
      data: {status}
    });
  }

  async createPaymentSession(order: OrderWithProductsInterface) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItem.map(item => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity
        }))
      })
    );

    return paymentSession;
  }

  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Order paid');

    const updatedOrder = await this.order.update({
      where: {id: paidOrderDto.orderId},
      data: {
        status: OrderStatus.PAID,
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,
        // Relation 1 to 1 created locally
        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    });

    return updatedOrder;
  }
}
