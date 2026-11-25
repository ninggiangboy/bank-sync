import type { Direction } from "@bank-sync/shared";
import { MANUAL_BANK_CODE } from "@bank-sync/shared";
import { env } from "../../config/env";
import { addMonths, localDate, type YearMonth, zonedInstant } from "../../domain/time";
import { Mt19937 } from "./mt19937";

export type LedgerRow = {
  bankCode: string;
  direction: Direction;
  amount: number;
  counterparty: string | null;
  description: string | null;
  occurredAt: Date;
  /** Name of a system category, or null to leave the row uncategorized. */
  category: string | null;
  note: string | null;
};

type Shop = readonly [name: string, min: number, max: number];
const COFFEE: Shop[] = [
  ["HIGHLANDS COFFEE", 39, 69],
  ["PHUC LONG", 45, 75],
  ["THE COFFEE HOUSE", 45, 69],
  ["KATINAT", 49, 79],
];
const DELIVERY: Shop[] = [
  ["GRABFOOD", 45, 120],
  ["SHOPEEFOOD", 40, 110],
  ["BE FOOD", 45, 95],
];
const RESTAURANTS: Shop[] = [
  ["NHA HANG NGON", 250, 600],
  ["PIZZA 4PS", 450, 900],
  ["GOGI HOUSE", 500, 900],
  ["LAU PHAN", 350, 700],
  ["SUSHI HOKKAIDO SACHI", 500, 1000],
];
const SHOPEE: readonly (readonly [string, number])[] = [
  ["Tai nghe bluetooth", 459],
  ["Op lung dien thoai", 89],
  ["Ao thun basic", 199],
  ["Binh giu nhiet", 245],
  ['Sach "Atomic Habits"', 139],
  ["Day sac Type-C", 79],
  ["Ke de laptop", 329],
];

type Day = { year: number; month: number; day: number; weekday: number };

const dayOf = (date: Date): Day => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  weekday: date.getUTCDay(),
});

/**
 * About three and a half months of believable spending for the demo account: an office worker in
 * Ho Chi Minh City with a salary, rent, bills, daily coffee and Grab, weekend dinners, online
 * shopping and a few one-off events. The random draws run in the same order as the original PHP
 * seeder, so a seed produces the same ledger. Dates end on `until`; `refresh-demo` keeps them current.
 */
export class DemoLedger {
  private readonly random = new Mt19937(2026);
  private rows: LedgerRow[] = [];

  /** `until` is an instant; days are counted on the display time zone's wall clock. */
  build(until: Date): LedgerRow[] {
    this.rows = [];
    const last = new Date(`${localDate(until, env.APP_TIMEZONE)}T00:00:00Z`);
    const lastMonth: YearMonth = { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1 };
    const first = addMonths(lastMonth, -3);
    const endOfLastDay = zonedInstant({ ...dayOf(last), hour: 23, minute: 59 });
    // The original ends at 23:59:59.999999 of the last day; rows have minute precision.
    const cutoff = endOfLastDay.getTime() + 59_999;

    for (
      let cursor = new Date(Date.UTC(first.year, first.month - 1, 1));
      cursor <= last;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const day = dayOf(cursor);
      this.monthly(day, day.year === lastMonth.year && day.month === lastMonth.month);
      this.daily(day);
    }
    this.oneOffs(new Date(Date.UTC(first.year, first.month - 1, 1)));

    return this.rows.filter((row) => row.occurredAt.getTime() <= cutoff);
  }

  private monthly(day: Day, isFinalMonth: boolean) {
    switch (day.day) {
      case 1:
        this.add(
          day,
          9,
          15,
          "out",
          245000,
          "Internet bill",
          "FPT TELECOM",
          "THANH TOAN CUOC INTERNET FPT",
          "CAKE",
        );
        break;
      case 3:
        this.add(
          day,
          20,
          40,
          "out",
          260000,
          "TV & streaming",
          "NETFLIX.COM",
          "NETFLIX.COM SINGAPORE",
          "VPB",
        );
        break;
      case 5:
        this.add(
          day,
          8,
          0,
          "out",
          690000,
          "Gym & fitness",
          "CALIFORNIA FITNESS & YOGA",
          "GIA HAN HOI VIEN THANG",
          "VPB",
        );
        break;
    }

    if (day.day === 7 && !isFinalMonth) {
      this.add(
        day,
        9,
        30,
        "in",
        25000000,
        "Salary",
        "CONG TY TNHH CONG NGHE ABC",
        "CONG TY TNHH CONG NGHE ABC TRA LUONG",
        "VCB",
      );
    }

    if (day.day === 8) {
      this.add(
        day,
        19,
        5,
        "out",
        2000000,
        "Transfers",
        "NGUYEN THI MAI",
        "Gui me tien tieu",
        "VCB",
        "Gửi mẹ",
      );
      this.add(
        day,
        19,
        20,
        "out",
        3000000,
        "Investment",
        "CTCP CHUNG KHOAN VNDIRECT",
        "NOP TIEN TAI KHOAN CHUNG KHOAN",
        "VCB",
      );
    }

    if (day.day === 11 && !isFinalMonth) {
      this.add(day, 20, 15, "out", 5500000, "Rentals", "LE THI HOA", "TIEN NHA", "VCB");
    }

    switch (day.day) {
      case 14:
        this.add(
          day,
          10,
          5,
          "out",
          this.money(620, 1150),
          "Electricity bill",
          "EVN HCMC",
          "THANH TOAN TIEN DIEN",
          "CAKE",
        );
        break;
      case 15:
        this.add(
          day,
          10,
          10,
          "out",
          this.money(110, 165),
          "Water bill",
          "SAWACO",
          "THANH TOAN TIEN NUOC",
          "CAKE",
        );
        break;
      case 17:
        this.add(
          day,
          12,
          0,
          "out",
          59000,
          "TV & streaming",
          "SPOTIFY",
          "SPOTIFY P2B3C4D5E6 STOCKHOLM",
          "VPB",
        );
        break;
      case 20:
        this.add(
          day,
          18,
          30,
          "out",
          1500000,
          "Cash withdrawal",
          null,
          "RUT TIEN ATM VCB TOWER",
          "VCB",
        );
        break;
    }
  }

  private daily(day: Day) {
    const isWeekend = day.weekday === 0 || day.weekday === 6;

    if (!isWeekend && this.chance(65)) {
      const [shop, min, max] = this.pick(COFFEE);
      this.add(
        day,
        7 + this.int(0, 2),
        this.int(0, 59),
        "out",
        this.money(min, max),
        "Coffee",
        shop,
        `THANH TOAN QR ${shop}`,
        this.pick(["VPB", "CAKE"]),
      );
    }

    if (!isWeekend && this.chance(45)) {
      const [app, min, max] = this.pick(DELIVERY);
      this.add(
        day,
        11,
        this.int(20, 59),
        "out",
        this.money(min, max),
        "Delivery",
        app,
        `${app} ORDER`,
        "CAKE",
      );
    } else if (!isWeekend && this.chance(60)) {
      this.add(
        day,
        12,
        this.int(0, 30),
        "out",
        this.money(35, 55),
        "Food & drink",
        "Com tam Ba Ghien",
        null,
        MANUAL_BANK_CODE,
      );
    }

    if (this.chance(isWeekend ? 45 : 35)) {
      this.add(
        day,
        this.int(8, 21),
        this.int(0, 59),
        "out",
        this.money(28, 135),
        "Taxi",
        "GRAB",
        "GRAB*TRANSPORT HO CHI MINH",
        "VPB",
      );
    }

    if (isWeekend && this.chance(35)) {
      const [restaurant, min, max] = this.pick(RESTAURANTS);
      this.add(
        day,
        19,
        this.int(0, 45),
        "out",
        this.money(min, max),
        "Restaurants",
        restaurant,
        `THANH TOAN THE ${restaurant}`,
        "VCB",
      );
    }

    if (day.weekday === 6) {
      this.add(
        day,
        10,
        this.int(0, 50),
        "out",
        this.money(250, 600),
        "Food & drink",
        this.pick(["BACH HOA XANH", "WINMART", "CO.OP MART"]),
        "THANH TOAN DI CHO",
        "VPB",
      );
    }

    if (day.weekday === 0 && this.chance(50)) {
      this.add(
        day,
        16,
        30,
        "out",
        this.money(70, 100),
        "Vehicle maintenance",
        "PETROLIMEX CHXD SO 12",
        "DO XANG",
        MANUAL_BANK_CODE,
      );
    }

    if (this.chance(14)) {
      const [item, price] = this.pick(SHOPEE);
      this.add(
        day,
        22,
        this.int(0, 59),
        "out",
        price * 1000,
        "Shopping",
        "SHOPEE",
        `SHOPEEPAY ${item}`,
        "CAKE",
      );
    }

    if (isWeekend && this.chance(18)) {
      this.add(
        day,
        20,
        10,
        "out",
        this.money(190, 260),
        "Movies",
        "CGV CINEMAS",
        "CGV VINCOM DONG KHOI 2 VE",
        "VPB",
      );
    }

    if (this.chance(4)) {
      this.add(
        day,
        15,
        20,
        "out",
        this.money(150, 450),
        null,
        this.pick(["TRAN MINH KHOA", "PHAM THU TRANG", "VO HOANG NAM"]),
        "chuyen tien",
        "VCB",
      );
    }
  }

  private oneOffs(start: Date) {
    const at = (offset: number): Day => dayOf(new Date(start.getTime() + offset * 86_400_000));
    this.add(
      at(9),
      14,
      0,
      "out",
      1850000,
      "Flights",
      "VIETJET AIR",
      "VE MAY BAY SGN-DAD",
      "VPB",
      "Đi Đà Nẵng cuối tuần",
    );
    this.add(
      at(12),
      11,
      0,
      "out",
      2400000,
      "Restaurants",
      "HAI SAN BE MAN",
      "THANH TOAN THE HAI SAN BE MAN",
      "VCB",
      "Ăn hải sản ở Đà Nẵng",
    );
    this.add(
      at(18),
      21,
      0,
      "out",
      1000000,
      "Wedding",
      "LE QUANG HUY",
      "Mung cuoi Huy va Ngoc",
      "VCB",
      "Đám cưới Huy",
    );
    this.add(
      at(24),
      9,
      40,
      "out",
      450000,
      "Doctor & hospital",
      "BENH VIEN DA KHOA TAM ANH",
      "KHAM BENH",
      "VCB",
    );
    this.add(
      at(24),
      10,
      30,
      "out",
      186000,
      "Medicine",
      "NHA THUOC LONG CHAU",
      "THANH TOAN QR LONG CHAU",
      "CAKE",
    );
    this.add(
      at(33),
      16,
      0,
      "out",
      2000000,
      "Lending",
      "PHAM THU TRANG",
      "Cho Trang muon",
      "VCB",
      "Trang hẹn trả cuối tháng",
    );
    this.add(
      at(41),
      19,
      45,
      "in",
      1200000,
      "Sales",
      "NGUYEN DUC TAI",
      "Mua ban phim co cu",
      "CAKE",
      "Bán bàn phím cũ trên Chợ Tốt",
    );
    this.add(at(47), 14, 20, "in", 199000, "Refund", "SHOPEE", "HOAN TIEN DON HANG SHOPEE", "CAKE");
    this.add(
      at(52),
      10,
      0,
      "out",
      350000,
      "Vehicle maintenance",
      "HEAD HONDA PHAT TIEN",
      "BAO DUONG XE",
      MANUAL_BANK_CODE,
    );
    this.add(
      at(58),
      20,
      0,
      "in",
      2000000,
      "Debt collection",
      "PHAM THU TRANG",
      "Tra tien muon",
      "VCB",
    );
    this.add(
      at(63),
      18,
      0,
      "in",
      3500000,
      "Other income",
      "STUDIO MOC",
      "THANH TOAN THIET KE LOGO",
      "VCB",
      "Freelance thiết kế logo",
    );
    this.add(
      at(70),
      19,
      30,
      "out",
      1300000,
      "Music & concerts",
      "TICKETBOX",
      "VE CONCERT ANH TRAI SAY HI",
      "VPB",
    );
    this.add(
      at(76),
      13,
      15,
      "out",
      799000,
      "Shopping",
      "UNIQLO DONG KHOI",
      "THANH TOAN THE UNIQLO",
      "VPB",
    );
    this.add(at(81), 17, 40, "out", 420000, "Beauty", "GUARDIAN", "THANH TOAN QR GUARDIAN", "CAKE");
    this.add(
      at(88),
      20,
      0,
      "out",
      500000,
      "Gifts & Donations",
      "QUY VI NGUOI NGHEO",
      "Ung ho mien Trung",
      "VCB",
    );
  }

  private add(
    day: Day,
    hour: number,
    minute: number,
    direction: Direction,
    amount: number,
    category: string | null,
    counterparty: string | null,
    description: string | null,
    bankCode: string,
    note: string | null = null,
  ) {
    this.rows.push({
      bankCode,
      direction,
      amount,
      counterparty,
      description: bankCode === MANUAL_BANK_CODE ? null : description,
      occurredAt: zonedInstant({ year: day.year, month: day.month, day: day.day, hour, minute }),
      category,
      note,
    });
  }

  private chance(percent: number) {
    return this.int(1, 100) <= percent;
  }

  private int(min: number, max: number) {
    return this.random.getInt(min, max);
  }

  /** A price in thousands of đồng, rounded to the nearest 1.000₫. */
  private money(minThousands: number, maxThousands: number) {
    return this.int(minThousands, maxThousands) * 1000;
  }

  private pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }
}
