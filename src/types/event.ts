import { EventType } from "./event-type";


export interface EventMetadata {
    id: string;                
    time: string;             
    source: string;           
    specversion: string;      
    datacontenttype?: string; 
    subject?: string;         
  }

  export interface CloudEvent<T = unknown> {
    metadata: EventMetadata;   
    type: EventType;          
    data: T;                  
  }