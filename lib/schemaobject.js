var _ = require('underscore')._;

if(typeof(Proxy) !== 'undefined') {
  require('harmony-reflect');
} else {
  console.warn('You are running node without the --harmony flag. SchemaObject will work, except using option strict: false will not.')
}

// Is a number (ignores type).
var isNumeric = function(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
};

// Used to fetch current values.
var getter = function(value, properties) {
  // Most calculations happen within the setter and the value passed is typically the value we want to use.
  // Typically, the getter just returns the value.
  // Modifications to the value within the getter are not written to the object.

  // Return default value if present & current value is undefined -- do not write to object
  if(_.isUndefined(value) && !_.isUndefined(properties.default)) {
    value = setter.call(this, (_.isFunction(properties.default) ? properties.default.call(this) : properties.default), value, properties);
  }

  return value;
};

// Returns typecasted value if possible. If rejected, originalValue is returned.
var setter = function(value, originalValue, properties) {
  // Allow transform to manipulate raw properties.
  if(properties.transform) {
    value = properties.transform.call(this, value, originalValue, properties);
  }

  switch(properties.type) {
    case 'string':
      // Reject if object or array.
      if(_.isObject(value) || _.isArray(value)) {
        return originalValue;
      }

      // If index is being set with null or undefined, set value and end.
      if(_.isUndefined(value) || value === null) {
        return value;
      }

      // Typecast to String.
      value = value + '';

      // If stringTransform function is defined, use.
      // This is used before we do validation checks (except to be sure we have a string at all).
      if(properties.stringTransform) {
        value = properties.stringTransform.call(this, value, originalValue, properties);
      }

      // If clip property & maxLength properties are set, the string should be clipped.
      // This is basically a shortcut property that could be done with stringTransform.
      if(properties.clip && !_.isUndefined(properties.maxLength)) {
        value = value.substr(0, properties.maxLength);
      }

      // Check against filters before returning value
      if(
        // If enum is being used, be sure the value is within definition.
        (_.isArray(properties.enum) && properties.enum.indexOf(value) === -1)

        // If minLength is defined, check to be sure the string is > minLength
        || (!_.isUndefined(properties.minLength) && value.length < properties.minLength)

        // If maxLength is defined, check to be sure the string is < maxLength
        || (!_.isUndefined(properties.maxLength) && value.length > properties.maxLength)

        // If regex is defined, check to be sure the string matches the regex pattern.
        || (properties.regex && !properties.regex.test(value))
      ) {
        // If the string doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      return value;
      break;

    case 'number':
      // Set values for boolean.
      if(_.isBoolean(value)) {
        value = value ? 1 : 0;
      }

      if(
        // Reject if array.
        _.isArray(value)

        // Reject if object.
        || _.isObject(value)

        // Reject if not numeric.
        || !isNumeric(value)
      ) {
         // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      // Typecast to number.
      value = value * 1;

      // Check against filters before returning value
      if(
        // If min is defined, check to be sure the integer is > min
        (!_.isUndefined(properties.min) && value < properties.min)

        // If max is defined, check to be sure the string is < max
        || (!_.isUndefined(properties.max) && value > properties.max)
      ) {
        // If the string doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      return value;
      break;

    case 'boolean':
      // If is String and is 'false', return false.
      if(_.isString(value) && value === 'false') {
        return false;
      }

      // If is Number, <0 is true and >0 is false.
      if(isNumeric(value)) {
        return (value * 1) > 0 ? true : false;
      }

      // Use Javascript to eval and return boolean.
      return value ? true : false;
      break;

    case 'array':
      // If it's an object, typecast to an array and return array.
      if(_.isObject(value)) {
        value = _.toArray(value);
      }

      // Reject if not array
      if(!_.isArray(value)) {
        // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      // Arrays are never set directly.
      // Instead, the values are copied over to the existing SchemaArray instance.
      // The SchemaArray is initialized immediately and will always exist.
      originalValue.length = 0;
      _.each(value, function(arrayValue) {
        originalValue.push(arrayValue);
      });

      return originalValue;
      break;

    case 'object':
      // If it's not an Object, reject.
      if(!_.isObject(value)) {
        // If the value doesn't meet requirements, it will remain untouched.
        return originalValue;
      }

      // If object is schema object and an entirely new object was passed, clear values and set.
      // This preserves the object instance.
      if(properties.objectType) {
        // The object will usually exist because it's initialized immediately for deep access within SchemaObjects.
        // However, in the case of Array elements, it will not exist.
        var schemaObject;
        if(!_.isUndefined(originalValue)) {
          // Clear existing values.
          schemaObject = originalValue;
          schemaObject.clear();
        } else {
          // The SchemaObject doesn't exist yet. Let's initialize a new one.
          // This is used for Array types.
          schemaObject = new properties.objectType;
        }

        // Copy value to SchemaObject and set value to SchemaObject.
        _.each(value, function(v, k) {
          schemaObject[k] = v;
        });
        value = schemaObject;
      }

      // Otherwise, it's OK.
      return value;
      break;

    case 'date':
      // Reject if object, array or boolean.
      if(!_.isDate(value) && !_.isString(value) && !_.isNumber(value)) {
        return originalValue;
      }

      // Attempt to parse string value with Date.parse (which returns number of milliseconds).
      if(_.isString(value)) {
        value = Date.parse(value);
      }

      // If is timestamp, convert to Date.
      if(_.isNumber(value)) {
        value = new Date((value + '').length > 10 ? value : value * 1000);
      }

      // If the date couldn't be parsed, do not modify index.
      if(value == 'Invalid Date' || !_.isDate(value)) {
        value = originalValue;
      }

      return value;
      break;

    default:
      return value;
      break;
  }
};

// Properties can be passed in multiple forms (an object, just a type, etc).
// Normalize to a standard format.
var normalizeProperties = function(properties) {
  // Allow for shorthand type declaration:

  // index: Type is translated to index: {type: Type}
  if(properties && _.isUndefined(properties.type)) {
    properties = {type: properties};
  }

  // Type may be an object with properties.
  // If "type.type" exists, we'll assume it's meant to be properties.
  // This means that shorthand objects can't use the "type" index.
  // If "type" is necessary, they must be wrapped in a SchemaObject.
  if(_.isObject(properties.type) && !_.isUndefined(properties.type.type)) {
    _.each(properties.type, function(value, key) {
      if(_.isUndefined(properties[key])) {
        properties[key] = value;
      }
    });
    properties.type = properties.type.type;
  }

  // Null or undefined should be flexible and allow any value.
  if(properties.type === null || properties.type === undefined) {
    properties.type = 'any';

  // Convert object representation of type to lowercase string.
  // String is converted to 'string', Number to 'number', etc.
  } else if(properties.type.name) {
    properties.type = properties.type.name;
  }
  if(_.isString(properties.type)) {
    properties.type = properties.type.toLowerCase();
  }

  // index: [Type] or index: [] is translated to index: {type: Array, arrayType: Type}
  if(_.isArray(properties.type)) {
    if(_.size(properties.type)) {
      // Properties will be normalized when array is initialized.
      properties.arrayType = properties.type[0];
    }
    properties.type = 'array';
  }

  // index: {} or index: SchemaObject is translated to index: {type: Object, objectType: Type}
  // SchemaObject factory is initialized when raw schema is provided.
  if(!_.isString(properties.type)) {
    if(_.isFunction(properties.type)) {
      properties.objectType = properties.type;
      properties.type = 'object';
    } else if(_.isObject(properties.type)) {
      if(_.size(properties.type)) {
        properties.objectType = new SchemaObject(properties.type);
      }
      properties.type = 'object';
    }
  }

  return properties;
};

// Represents a basic array with typecasted values.
var SchemaArray = function(self, properties) {
  this._self = self;
  this._properties = properties;

  if(this._properties.arrayType) {
    this._properties.arrayType = normalizeProperties(this._properties.arrayType);
  }
};
SchemaArray.prototype = new Array;
SchemaArray.prototype.push = function() {
  // Values are passed through the setter before being allowed onto the array if arrayType is set.
  // In the case of rejection, the setter returns undefined, which is not appended to the array.
  var values;
  if(this._properties.arrayType) {
    values = [].map.call(arguments, function(value) {
      return setter.call(this._self, value, undefined, this._properties.arrayType);
    }, this);
  } else {
    values = arguments;
  }

  if(this._properties.unique) {
    values = _.difference(values, _.toArray(this));
  }

  var ret = [].push.apply(this, values);

  return ret;
};
SchemaArray.prototype.toArray = function() {
  // Create new Array to hold elements.
  var array = [];

  // Loop through each element, clone if necessary.
  _.each(this, function(element) {
    // Call toObject() method if defined (this allows us to return primitive objects instead of SchemaObjects).
    if(_.isObject(element) && _.isFunction(element.toObject)) {
      element = element.toObject();

    // If is non-SchemaType object, shallow clone so that properties modification don't have an affect on the original object.
    } else if(_.isObject(element)) {
      element = _.clone(element);
    }

    array.push(element);
  });

  return array;
};

// Represents an object with typed indexes.
var SchemaObject = function(schema, options) {
  // Create object for options if doesn't exist and merge with defaults.
  if(!options) {
    options = {};
  }
  options = _.extend({
    strict: true
  }, options);

  // Represents an instance of the SchemaObject and should be bound to inherited schema.
  return function(defaults) {
    var self = this,
        obj,
        proxy = undefined;

    // Object used to store properties internally.
    self._obj = obj = {};

    // Schema as defined by constructor.
    self._schema = schema;

    // Normalize schema properties to allow for various shorthand declarations.
    _.each(schema, function(properties, index) {
      schema[index] = normalizeProperties(properties);
    });

    // Define getters/setters based off of schema.
    _.each(schema, function(properties, index) {
      // The actual index on the object may be an alias.
      var objIndex = index;
      if(properties.type === 'alias') {
        // Set objIndex to the the alias index so that the getter/setter will write to the referenced index.
        objIndex = properties.index;

        // Use properties of referenced index.
        // TODO: Allow for alias to be recognized via dot-notation.
        var referencedProperties = _.extend(schema[objIndex]);
        referencedProperties.isAlias = true;

        // Allow alias to use transform() to pre-transform any values passing through it.
        if(properties.transform) {
          referencedProperties.transform = function(value, originalValue, properties) {
            value = properties.transform.call(this, value, originalValue, properties);
            value = referencedProperties.transform.call(this, value, originalValue, properties);
            return value;
          };
        }
      }

      // Use getter / setter to intercept and re-route, transform, etc.
      self.__defineGetter__(index, function() {
        return getter.call(self, obj[objIndex], properties);
      });
      self.__defineSetter__(index, function(value) {
        // Don't proceed if readOnly is true.
        if(properties.readOnly) {
          return;
        }

        // self[index] is used instead of obj[index] to route through the getter
        obj[objIndex] = setter.call(self, value, self[objIndex], properties);
      });

      // In case of object & array, they must be initialized immediately. However, this should not be done for aliases.
      if(properties.isAlias !== true) {
        if(properties.type === 'object') {
          obj[objIndex] = properties.objectType ? new properties.objectType : {};

        // Native arrays are never used so that toArray can be globally supported.
        // Additionally, other properties such as unique rely on passing through SchemaObject.
        } else if(properties.type === 'array') {
          obj[objIndex] = new SchemaArray(self, properties);
        }
      }
    });

    // Return object without getter/setters, extra properties, etc.
    this.toObject = function() {
      var getObj = {};

      // Populate all properties in schema.
      _.each(schema, function(properties, index) {
        // Do not write values to object that are marked as writeOnly
        if(properties.invisible) {
          return;
        }

        // Fetch value from self[index] to route through getter.
        var value = self[index];

        // If value does not need to be cloned, place in index.
        if((value === undefined || value === null)
        || properties.type !== 'object' && properties.type !== 'array' && properties.type !== 'date') {
          getObj[index] = value;

        // Clone Object
        } else if(properties.type === 'object') {
          // Call toObject() method if defined (this allows us to return primitive objects instead of SchemaObjects).
          if(_.isFunction(value.toObject)) {
            getObj[index] = value.toObject();

          // If is non-SchemaType object, shallow clone so that properties modification don't have an affect on the original object.
          } else if(_.isObject(value)) {
            getObj[index] = _.clone(value);
          }

        // Clone Array
        } else if(properties.type === 'array') {
          // Built in method to clone array to native type
          getObj[index] = value.toArray();

        // Clone Date object.
        } else if(properties.type === 'date') {
          // https://github.com/documentcloud/underscore/pull/863
          // _.clone doesn't work on Date object.
          getObj[index] = new Date(value.getTime());
        }
      });

      return getObj;
    };

    // toJSON is an interface used by JSON.stringify.
    // Return the raw object if called.
    this.toJSON = this.toObject;

    // Clear all values.
    this.clear = function() {
      self._obj = {};
    };

    // Harmony proxy used as interface to object allows to intercept all access.
    // Without Proxy we must register individual getter/setters.
    if(typeof(Proxy) !== 'undefined') {
      proxy = Proxy(self, {
        get: function(target, name, receiver) {
          return self[name];
        },
        set: function(target, name, value, receiver) {
          if(!schema[name]) {
            if(options.strict) {
              // Strict mode means we don't want to deal with anything not in the schema.
              return;
            } else {
              // Add index to schema.
              // This is necessary for toObject to see the field.
              schema[name] = normalizeProperties({ type: 'any' });
            }
          }

          // This hits the registered getter/setters.
          self[name] = value;
        }
      });
    }

    // Populate runtime defaults as provided to this instance of object.
    // (Different than the default for each field - is simply a shortcut to populate values in object.)
    if(_.isObject(defaults)) {
      _.each(defaults, function(value, key) {
        self[key] = value;
      });
    };

    // If the proxy is available, we use that, otherwise fallback.
    return proxy ? proxy : self;
  }
};

module.exports = SchemaObject;