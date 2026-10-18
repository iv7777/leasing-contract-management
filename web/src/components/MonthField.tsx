import { DatePicker, type DatePickerProps } from "antd";
import dayjs from "dayjs";

type MonthFieldProps = Omit<DatePickerProps, "value" | "onChange" | "picker"> & {
  value?: string;
  onChange?: (value?: string) => void;
};

/** A calendar for picking a month; the value is a plain "YYYY-MM" string. */
export default function MonthField({ value, onChange, ...rest }: MonthFieldProps) {
  return (
    <DatePicker
      picker="month"
      style={{ width: "100%" }}
      format="YYYY-MM"
      allowClear={false}
      value={value ? dayjs(`${value}-01`) : null}
      onChange={(d) => onChange?.(d ? d.format("YYYY-MM") : undefined)}
      {...rest}
    />
  );
}
