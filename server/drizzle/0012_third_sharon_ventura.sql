ALTER TABLE `rate_schedule` ADD `linked_stream_id` integer REFERENCES pricing_streams(id);
