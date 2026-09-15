import { DatePicker, type DatePickerProps } from "antd";
import dayjs from "dayjs";

type DateFieldProps = Omit<DatePickerProps, "value" | "onChange" | "picker"> & {
  value?: string;
  onChange?: (value?: string) => void;
};

export default function DateField({ value, onChange, ...rest }: DateFieldProps) {
  return (
    <DatePicker
      style={{ width: "100%" }}
      format="YYYY-MM-DD"
      value={value ? dayjs(value) : null}
      onChange={(d) => onChange?.(d ? d.format("YYYY-MM-DD") : undefined)}
      {...rest}
    />
  );
}
