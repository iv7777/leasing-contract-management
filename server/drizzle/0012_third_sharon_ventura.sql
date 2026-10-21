ALTER TABLE `rate_schedule` ADD `linked_stream_id` integer REFERENCES pricing_streams(id);
--> statement-breakpoint
-- "Fixed amount, per unit" could be entered before but could never be billed. It
-- is what a per-unit service fee on a metered item was meant to be: convert it,
-- linking it to the contract's metered item when there is exactly one.
UPDATE `rate_schedule`
SET `calculation_method` = 'usage_fee_per_unit',
    `linked_stream_id` = (
      SELECT CASE WHEN COUNT(DISTINCT ms.id) = 1 THEN MIN(ms.id) END
      FROM `pricing_streams` ms
      JOIN `rate_schedule` r2 ON r2.pricing_stream_id = ms.id AND r2.calculation_method = 'metered'
      WHERE ms.contract_id = (SELECT p.contract_id FROM `pricing_streams` p WHERE p.id = `rate_schedule`.`pricing_stream_id`)
        AND ms.id <> `rate_schedule`.`pricing_stream_id`
    )
WHERE `calculation_method` = 'flat' AND `rate_basis` = 'per_unit';
