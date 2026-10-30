// Tipos escritos à mão a partir de supabase/migrations/0001_init.sql.
// Se o schema mudar, atualize aqui (ou gere com `supabase gen types typescript`).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PositionStatus = "open" | "closed";
export type CashKind = "deposit" | "withdraw" | "adjust" | "buy" | "sell";
export type QuoteSource = "fundamentus" | "infomoney";
export type OrderStatus = "pending" | "executing" | "executed" | "cancelled" | "expired" | "failed";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          is_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      positions: {
        Row: {
          id: string;
          created_by: string | null;
          ticker: string;
          quantity: number;
          buy_date: string; // YYYY-MM-DD
          buy_price: number;
          buy_screenshot_path: string | null;
          status: PositionStatus;
          sell_date: string | null;
          sell_price: number | null;
          sell_screenshot_path: string | null;
          closed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          created_by?: string | null;
          ticker: string;
          quantity?: number;
          buy_date: string;
          buy_price: number;
          buy_screenshot_path?: string | null;
          status?: PositionStatus;
          sell_date?: string | null;
          sell_price?: number | null;
          sell_screenshot_path?: string | null;
          closed_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          created_by?: string | null;
          ticker?: string;
          quantity?: number;
          buy_date?: string;
          buy_price?: number;
          buy_screenshot_path?: string | null;
          status?: PositionStatus;
          sell_date?: string | null;
          sell_price?: number | null;
          sell_screenshot_path?: string | null;
          closed_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cash_movements: {
        Row: {
          id: number;
          kind: CashKind;
          amount: number;
          position_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          kind: CashKind;
          amount: number;
          position_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          kind?: CashKind;
          amount?: number;
          position_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_movements_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          id: number;
          ticker: string;
          source: QuoteSource;
          quote_date: string; // YYYY-MM-DD
          price: number;
          open: number | null;
          high: number | null;
          low: number | null;
          volume: number | null;
          change_pct: number | null;
          scraped_at: string;
          raw: Json | null;
        };
        Insert: {
          id?: never;
          ticker: string;
          source: QuoteSource;
          quote_date: string;
          price: number;
          open?: number | null;
          high?: number | null;
          low?: number | null;
          volume?: number | null;
          change_pct?: number | null;
          scraped_at?: string;
          raw?: Json | null;
        };
        Update: {
          id?: never;
          ticker?: string;
          source?: QuoteSource;
          quote_date?: string;
          price?: number;
          open?: number | null;
          high?: number | null;
          low?: number | null;
          volume?: number | null;
          change_pct?: number | null;
          scraped_at?: string;
          raw?: Json | null;
        };
        Relationships: [];
      };
      scheduled_orders: {
        Row: {
          id: string;
          ticker: string;
          quantity: number;
          limit_price: number;
          valid_until: string | null;
          status: OrderStatus;
          position_id: string | null;
          executed_price: number | null;
          executed_at: string | null;
          last_checked_at: string | null;
          last_check_price: number | null;
          error: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticker: string;
          quantity: number;
          limit_price: number;
          valid_until?: string | null;
          status?: OrderStatus;
          position_id?: string | null;
          executed_price?: number | null;
          executed_at?: string | null;
          last_checked_at?: string | null;
          last_check_price?: number | null;
          error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticker?: string;
          quantity?: number;
          limit_price?: number;
          valid_until?: string | null;
          status?: OrderStatus;
          position_id?: string | null;
          executed_price?: number | null;
          executed_at?: string | null;
          last_checked_at?: string | null;
          last_check_price?: number | null;
          error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      cash_balance: {
        Row: {
          balance: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicTables = Database["public"]["Tables"];
export type Tables<T extends keyof PublicTables> = PublicTables[T]["Row"];
export type TablesInsert<T extends keyof PublicTables> = PublicTables[T]["Insert"];
export type TablesUpdate<T extends keyof PublicTables> = PublicTables[T]["Update"];

export type Profile = Tables<"profiles">;
export type Position = Tables<"positions">;
export type CashMovement = Tables<"cash_movements">;
export type Quote = Tables<"quotes">;
export type ScheduledOrder = Tables<"scheduled_orders">;
