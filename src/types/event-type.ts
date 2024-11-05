// Here we define all types of events

export enum EventType {
    // // New record
    // CITIZEN_REQUEST_CREATED = 'tg.ecitizen.request.created',
    // CITIZEN_REQUEST_UPDATED = 'tg.ecitizen.request.updated',
    // CITIZEN_REQUEST_DELETED = 'tg.ecitizen.request.deleted',
  
    // // Payment
    // PAYMENT_INITIATED = 'tg.ecitizen.payment.initiated',
    // PAYMENT_COMPLETED = 'tg.ecitizen.payment.completed',
    // PAYMENT_FAILED = 'tg.ecitizen.payment.failed',
  
    // // Workflow
    // WORKFLOW_STARTED = 'tg.ecitizen.workflow.started',
    // WORKFLOW_COMPLETED = 'tg.ecitizen.workflow.completed',
    // WORKFLOW_FAILED = 'tg.ecitizen.workflow.failed'


    // ############## FOR SAMPLE E-COMMERCE PROJECT ##############
   // Order events
  ORDER_CREATED = 'order.created',
  ORDER_CONFIRMED = 'order.confirmed',
  ORDER_FAILED = 'order.failed',
  ORDER_COMPLETED = 'order.completed',
  
  // Stock events
  STOCK_CHECK = 'stock.check',
  STOCK_CHECK_RESPONSE = 'stock.check.response',
  STOCK_RESERVED = 'stock.reserved',
  STOCK_RELEASED = 'stock.released',
  
  // Payment events
  PAYMENT_INITIATED = 'payment.initiated',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed'
}