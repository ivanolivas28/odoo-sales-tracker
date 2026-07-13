export interface SaleOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  user_id: [number, string] | false;
  amount_total: number;
  state: string;
  date_order: string;
}
