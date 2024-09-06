export interface Message {
  id: string;
  content: string;
  sender: string;
  timestamp: number;
}

export interface Room {
  id: string;
  name: string;
}
