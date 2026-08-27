import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable("version_sync_history", (table) => {
        table.increments("id");
        table.string("stack_name", 255).notNullable();
        table.string("endpoint", 255).notNullable().defaultTo("");
        table.string("service", 255).notNullable();
        table.string("old_image", 500).notNullable();
        table.string("new_image", 500).notNullable();
        table.string("compose_path", 1000).notNullable();
        table.boolean("is_revert").notNullable().defaultTo(false);
        table.string("created_at", 50).notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable("version_sync_history");
}
