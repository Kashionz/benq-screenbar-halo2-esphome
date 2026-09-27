"""Authenticated polling API and serialized Halo 2 command dispatcher."""
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_PASSWORD, CONF_PORT, CONF_USERNAME

DEPENDENCIES = ["esp32", "network", "web_server"]
AUTO_LOAD = ["json"]
ns = cg.esphome_ns.namespace("halo2_api")
Halo2Api = ns.class_("Halo2Api", cg.Component)
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(Halo2Api),
    cv.Required(CONF_USERNAME): cv.string_strict,
    cv.Required(CONF_PASSWORD): cv.string_strict,
    cv.Optional(CONF_PORT, default=8080): cv.port,
}).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_credentials(config[CONF_USERNAME], config[CONF_PASSWORD]))
    cg.add(var.set_port(config[CONF_PORT]))
