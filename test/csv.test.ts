import { describe, it, expect } from "vitest";
import { parseCsvStatement, parseDate, detectDelimiter } from "@/lib/parse/csv";

describe("parseDate", () => {
  it("parses ISO dates", () => {
    expect(parseDate("2026-03-14")).toBe("2026-03-14");
  });
  it("parses US month-first dates", () => {
    expect(parseDate("03/14/2026")).toBe("2026-03-14");
  });
  it("parses day-first when told to", () => {
    expect(parseDate("03/04/2026", true)).toBe("2026-04-03");
  });
  it("resolves ambiguity from the value itself", () => {
    expect(parseDate("14/03/2026")).toBe("2026-03-14");
  });
  it("parses textual dates", () => {
    expect(parseDate("14 Mar 2026")).toBe("2026-03-14");
    expect(parseDate("Mar 14, 2026")).toBe("2026-03-14");
  });
  it("expands two-digit years", () => {
    expect(parseDate("03/14/26")).toBe("2026-03-14");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("detectDelimiter", () => {
  it("finds commas and semicolons", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
});

describe("parseCsvStatement", () => {
  it("parses a standard single-amount export", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-03-14,TRADER JOES #452,-45.20",
      "2026-03-15,PAYROLL DEPOSIT,2500.00",
    ].join("\n");

    const { transactions } = parseCsvStatement(csv);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      postedOn: "2026-03-14",
      amountCents: -4520,
      rawDescription: "TRADER JOES #452",
    });
    expect(transactions[1]!.amountCents).toBe(250000);
  });

  it("handles separate debit and credit columns", () => {
    const csv = [
      "Transaction Date,Description,Debit,Credit",
      "03/14/2026,COFFEE SHOP,4.50,",
      "03/15/2026,REFUND,,22.00",
    ].join("\n");

    const { transactions } = parseCsvStatement(csv);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]!.amountCents).toBe(-450);
    expect(transactions[1]!.amountCents).toBe(2200);
  });

  it("handles quoted fields containing commas", () => {
    const csv = [
      "Date,Description,Amount",
      '2026-03-14,"ACME, INC. PAYMENT",-100.00',
    ].join("\n");

    const { transactions } = parseCsvStatement(csv);
    expect(transactions[0]!.rawDescription).toBe("ACME, INC. PAYMENT");
  });

  it("skips preamble rows before the real header", () => {
    const csv = [
      "Account Summary",
      "Account Number,****4321",
      "",
      "Date,Description,Amount",
      "2026-03-14,STARBUCKS,-6.75",
    ].join("\n");

    const { transactions } = parseCsvStatement(csv);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.amountCents).toBe(-675);
  });

  it("flips signs on a spending-positive export", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-03-01,A,10.00",
      "2026-03-02,B,20.00",
      "2026-03-03,C,30.00",
      "2026-03-04,D,40.00",
      "2026-03-05,E,50.00",
    ].join("\n");

    const { transactions, warnings } = parseCsvStatement(csv);
    expect(transactions.every((t) => t.amountCents < 0)).toBe(true);
    expect(warnings.join(" ")).toMatch(/spending-positive/);
  });

  /*
   * The flip is how a spending-positive export is read correctly, and it is
   * also the one way a whole month of income can be turned into spending in a
   * single step. So how much evidence it takes depends on the account.
   */
  describe("sign convention by account", () => {
    const mostlyDeposits = [
      "Date,Description,Amount",
      "2026-03-01,PAYROLL,2000.00",
      "2026-03-02,PAYROLL,2000.00",
      "2026-03-03,TAX REFUND,3000.00",
      "2026-03-04,ZELLE FROM SAM,150.00",
      "2026-03-05,BONUS,1000.00",
      "2026-03-06,COFFEE,-4.50",
    ].join("\n");

    it("never flips a deposit account, however lopsided the month", () => {
      // A month with more coming in than going out is ordinary — a bonus, a
      // tax refund. Negating it would delete every paycheck in the file.
      const { transactions, warnings } = parseCsvStatement(mostlyDeposits, {
        accountKind: "checking",
      });
      const income = transactions.filter((t) => t.amountCents > 0);
      expect(income).toHaveLength(5);
      expect(warnings.join(" ")).toMatch(/read as money arriving/);
    });

    it("flips a credit card on a clear majority", () => {
      // Charges are positive in plenty of card exports, and a card statement
      // is overwhelmingly charges.
      const csv = [
        "Date,Description,Amount",
        "2026-03-01,STARBUCKS,5.00",
        "2026-03-02,TARGET,40.00",
        "2026-03-03,SHELL,30.00",
        "2026-03-04,AMAZON,20.00",
        "2026-03-05,PAYMENT THANK YOU,-500.00",
      ].join("\n");

      const { transactions } = parseCsvStatement(csv, {
        accountKind: "credit_card",
      });
      const starbucks = transactions.find((t) =>
        t.rawDescription.includes("STARBUCKS"),
      );
      expect(starbucks!.amountCents).toBe(-500);
    });

    it("needs every row positive when the account is unknown", () => {
      // One outflow is enough to show the file already uses our convention.
      const { transactions } = parseCsvStatement(mostlyDeposits);
      const income = transactions.filter((t) => t.amountCents > 0);
      expect(income).toHaveLength(5);
    });
  });

  it("strips a UTF-8 BOM from the first header cell", () => {
    const csv = "﻿Date,Description,Amount\n2026-03-14,TEST,-5.00";
    const { transactions } = parseCsvStatement(csv);
    expect(transactions).toHaveLength(1);
  });

  it("reports when nothing usable is found", () => {
    const { transactions, warnings } = parseCsvStatement("garbage\nmore garbage");
    expect(transactions).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
