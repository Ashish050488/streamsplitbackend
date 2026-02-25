const Joi = require('joi');

const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
  if (error) {
    const messages = error.details.map(d => d.message);
    return res.status(400).json({ success: false, message: 'Validation failed', errors: messages });
  }
  req[source] = value;
  next();
};

module.exports = validate;
