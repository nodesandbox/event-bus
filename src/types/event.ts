export interface EventMetadata {
  id: string;                
  time: string;             
  source: string;           
  specversion: string;      
  datacontenttype?: string; 
  subject?: string;         
  correlationId?: string;
}

export interface CloudEvent<T = unknown, E extends string = string> {
  metadata: EventMetadata;   
  type: E;          
  data: T;                  
}