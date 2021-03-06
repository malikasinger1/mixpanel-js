import {nearestInteractiveElement} from 'mixpanel-js-utils';

import Config from './config';
import { _ } from './utils';

var DISABLE_COOKIE = '__mpced';

var ce = {
    _previousElementSibling: function(el) {
        if (el.previousElementSibling) {
            return el.previousElementSibling;
        } else {
            do {
                el = el.previousSibling;
            } while (el && el.nodeType !== 1);
            return el;
        }
    },

    _loadScript: function(scriptUrlToLoad, callback) {
        var scriptTag = document.createElement('script');
        scriptTag.type = 'text/javascript';
        scriptTag.src = scriptUrlToLoad;
        scriptTag.onload = callback;

        var scripts = document.getElementsByTagName('script');
        if (scripts.length > 0) {
            scripts[0].parentNode.insertBefore(scriptTag, scripts[0]);
        } else {
            document.body.appendChild(scriptTag);
        }
    },

    _getPropertiesFromElement: function(elem, includeTextContent) {
        includeTextContent = !!includeTextContent;
        var props = {
            'classes': elem.className.split(' '),
            'tag_name': elem.tagName
        };

        if (includeTextContent) {
            // The "replace" here is a replacement for "trim," which some old browsers don't have
            props['text'] = elem.textContent.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '').substring(0, 255);
        }

        if (_.includes(['input', 'select', 'textarea'], elem.tagName.toLowerCase())) {
            props['value'] = this._getFormFieldValue(elem);
        }

        _.each(elem.attributes, function(attr) {
            props['attr__' + attr.name] = attr.value;
        });

        var nthChild = 1;
        var nthOfType = 1;
        var currentElem = elem;
        while (currentElem = this._previousElementSibling(currentElem)) { // eslint-disable-line no-cond-assign
            nthChild++;
            if (currentElem.tagName === elem.tagName) {
                nthOfType++;
            }
        }
        props['nth_child'] = nthChild;
        props['nth_of_type'] = nthOfType;

        return props;
    },

    _shouldTrackDomEvent: function(element, event) {
        if (!(element && typeof(element) === 'object')) {
            return false;
        }
        var tag = element.tagName.toLowerCase();
        switch (tag) {
            case 'form':
                return event.type === 'submit';
            case 'input':
                if (['button', 'submit'].indexOf(element.getAttribute('type')) === -1) {
                    return event.type === 'change';
                } else {
                    return event.type === 'click';
                }
            case 'select':
            case 'textarea':
                return event.type === 'change';
            default:
                return event.type === 'click';
        }
    },

    _getDefaultProperties: function(eventType) {
        return {
            '$event_type': eventType,
            '$ce_version': 1,
            '$host': window.location.host,
            '$pathname': window.location.pathname
        };
    },

    _getInputValue: function(input) {
        var value;
        var type = input.type.toLowerCase();
        switch(type) {
            case 'checkbox':
                if (input.checked) {
                    value = [input.value];
                }
                break;
            case 'radio':
                if (input.checked) {
                    value = input.value;
                }
                break;
            default:
                value = input.value;
                break;
        }
        return value;
    },

    _getSelectValue: function(select) {
        var value;
        if (select.multiple) {
            var values = [];
            _.each(select.querySelectorAll('[selected]'), function(option) {
                values.push(option.value);
            });
            value = values;
        } else {
            value = select.value;
        }
        return value;
    },

    _sanitizeInputValue: function(input, value) {
        var classes = (input.className || '').split(' ');
        if (_.includes(classes, 'mp-never-strip-value')) { // never sanitize inputs with class "mp-never-strip-value"
            return value;
        } else if (_.includes(classes, 'mp-always-strip-value')) { // always sanitize fields with class "mp-always-strip-value"
            return '[stripped]';
        }

        // don't include hidden or password fields
        var type = input.type || '';
        switch(type.toLowerCase()) {
            case 'hidden':
                return '[stripped]';
            case 'password':
                return '[stripped]';
        }

        // filter out data from fields that look like sensitive fields
        var name = input.name || input.id || '';
        var sensitiveNameRegex = /^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|seccode|securitycode|securitynum|socialsec|socsec|ssn/i;
        if (sensitiveNameRegex.test(name.replace(/[^a-zA-Z0-9]/g, ''))) {
            return '[stripped]';
        }

        if (typeof value === 'string') {
            // check to see if input value looks like a credit card number
            // see: https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9781449327453/ch04s20.html
            var ccRegex = /^(?:(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11}))$/;
            if (ccRegex.test((value || '').replace(/[\- ]/g, ''))) {
                return '[stripped]';
            }

            // check to see if input value looks like a social security number
            var ssnRegex = /(^\d{3}-?\d{2}-?\d{4}$)/;
            if (ssnRegex.test(value)) {
                return '[stripped]';
            }
        }

        // return unmodified value
        return value;
    },

    _getFormFieldValue: function(field) {
        var val;
        switch(field.tagName.toLowerCase()) {
            case 'input':
                val = this._getInputValue(field);
                break;
            case 'select':
                val = this._getSelectValue(field);
                break;
            default:
                val = field.value || field.textContent;
                break;
        }
        return this._sanitizeInputValue(field, val);
    },

    _getFormFieldProperties: function(form) {
        var formFieldProps = {};
        _.each(form.elements, function(field) {
            var name = field.getAttribute('name') || field.getAttribute('id');
            if (name !== null) {
                name = '$form_field__' + name;
                var val = this._getFormFieldValue(field);
                if (val !== undefined) {
                    var prevFieldVal = formFieldProps[name];
                    if (prevFieldVal !== undefined) { // combine values for inputs of same name
                        formFieldProps[name] = [].concat(prevFieldVal, val);
                    } else {
                        formFieldProps[name] = val;
                    }
                }
            }
        }, this);
        return formFieldProps;
    },

    _extractCustomPropertyValue: function(customProperty) {
        var propValues = [];
        _.each(document.querySelectorAll(customProperty['css_selector']), function(matchedElem) {
            if (['input', 'select'].indexOf(matchedElem.tagName.toLowerCase()) > -1) {
                propValues.push(matchedElem['value']);
            } else if (matchedElem['textContent']) {
                propValues.push(matchedElem['textContent']);
            }
        });
        return propValues.join(', ');
    },

    _getCustomProperties: function(targetElementList) {
        var props = {};
        _.each(this._customProperties, function(customProperty) {
            _.each(customProperty['event_selectors'], function(eventSelector) {
                var eventElements = document.querySelectorAll(eventSelector);
                _.each(eventElements, function(eventElement) {
                    if (_.includes(targetElementList, eventElement)) {
                        props[customProperty['name']] = this._extractCustomPropertyValue(customProperty);
                    }
                }, this);
            }, this);
        }, this);
        return props;
    },

    checkForBackoff: function(resp) {
        // temporarily stop CE for X seconds if the 'X-MP-CE-Backoff' header says to
        var secondsToDisable = parseInt(resp.getResponseHeader('X-MP-CE-Backoff'));
        if (!isNaN(secondsToDisable) && secondsToDisable > 0) {
            var disableUntil = _.timestamp() + (secondsToDisable * 1000);
            console.log('disabling CE for ' + secondsToDisable + ' seconds (from ' + _.timestamp() + ' until ' + disableUntil + ')');
            _.cookie.set(DISABLE_COOKIE, true, secondsToDisable, true);
        }
    },

    _trackEvent: function(e, instance) {
        /*** Don't mess with this code without running IE8 tests on it ***/
        var target;
        if (typeof e.target === 'undefined') {
            target = e.srcElement;
        } else {
            target = e.target;
        }
        if (target.nodeType && target.nodeType === Node.TEXT_NODE) { // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = target.parentNode;
        }

        if (target === document || target === document.body || target.nodeType !== Node.ELEMENT_NODE) {
            return;
        }


        // The actual target element might be some <span> inside a button or anchor tag.
        // We use the 'nearestInteractiveElement' to attempt to detect the
        // element that is actually interesting (i.e. interactable)
        // that way the top level properties are more consistent and
        // more likely to be what our customers expect to see
        //
        // E.g <a href="some_page.html"><span>Hello <span style="font-weight: bold">You</span></span></a>
        // If that is clicked, an inner span is likely the e.target but it's more likely our customers
        // care about the click on the anchor tag. 'nearestInteractElement' will return the anchor tag given
        // one of those spans.
        var calculatedTarget = nearestInteractiveElement(target);

        // allow users to programatically prevent tracking of elements by adding class 'mp-no-track'
        var targetClasses = (target.className || '').split(' ');
        var calculatedTargetClasses = (calculatedTarget.className || '').split(' ');
        var classes = targetClasses.concat(calculatedTargetClasses);
        if (_.includes(classes, 'mp-no-track')) {
            return;
        }

        var targetElementList = [target];
        var curEl = target;
        while (curEl.parentNode && curEl.parentNode !== document.body) {
            targetElementList.push(curEl.parentNode);
            curEl = curEl.parentNode;
        }

        var elementsJson = [];
        if (this._shouldTrackDomEvent(target, e)) {
            _.each(targetElementList, function(el, idx) {
                elementsJson.push(this._getPropertiesFromElement(el, idx === 0));
            }, this);

            var calculatedTargetProps = this._getPropertiesFromElement(calculatedTarget, true);
            var calculatedTargetIdx = targetElementList.indexOf(calculatedTarget);
            var propsToIgnore = ['attr__class', 'nth_child', 'nth_of_type'];
            var elProps = {};
            for (var prop in calculatedTargetProps) {
                if (propsToIgnore.indexOf(prop) === -1) {
                    elProps['$el_' + prop] = calculatedTargetProps[prop];
                }
            }

            var formFieldProps = {};
            if (e.type === 'submit' && e.target.tagName.toLowerCase() === 'form') {
                formFieldProps = this._getFormFieldProperties(e.target);
            }

            var props = _.extend(
                this._getDefaultProperties(e.type),
                {
                    '$calculatedElementIdx': calculatedTargetIdx,
                    '$elements':  elementsJson
                },
                elProps,
                formFieldProps,
                this._getCustomProperties(targetElementList)
            );
            instance.track('$web_event', props);
        }
    },

    _addDomEventHandlers: function(instance) {
        var handler = _.bind(function(e) {
            if (_.cookie.parse(DISABLE_COOKIE) !== true) {
                e = e || window.event;
                this._trackEvent(e, instance);
            }
        }, this);
        _.register_event(document, 'submit', handler, false, true);
        _.register_event(document, 'change', handler, false, true);
        _.register_event(document, 'click', handler, false, true);
    },

    _customProperties: {},
    init: function(instance) {
        if (!(document && document.body)) {
            console.log('document not ready yet, trying again in 500 milliseconds...');
            var that = this;
            setTimeout(function() { that.init(instance); }, 500);
            return;
        }

        if (!this._maybeLoadEditor(instance)) { // don't collect everything  when the editor is enabled
            var parseDecideResponse = _.bind(function(response) {
                if (response && response['config'] && response['config']['enable_collect_everything'] === true) {
                    if (response['custom_properties']) {
                        this._customProperties = response['custom_properties'];
                    }

                    instance.track('$web_event', _.extend({
                        '$title': document.title
                    }, this._getDefaultProperties('pageview')));

                    this._addDomEventHandlers(instance);
                } else {
                    instance['__autotrack_enabled'] = false;
                }
            }, this);

            instance._send_request(
                instance.get_config('decide_host') + '/decide/', {
                    'verbose': true,
                    'version': '1',
                    'lib': 'web',
                    'token': instance.get_config('token')
                },
                instance._prepare_callback(parseDecideResponse)
            );
        }
    },

    _editorParamsFromHash: function(instance, hash) {
        var editorParams;
        try {
            var state = _.getHashParam(hash, 'state');
            state = JSON.parse(decodeURIComponent(state));
            var expiresInSeconds = _.getHashParam(hash, 'expires_in');
            editorParams = {
                'accessToken': _.getHashParam(hash, 'access_token'),
                'accessTokenExpiresAt': (new Date()).getTime() + (Number(expiresInSeconds) * 1000),
                'appHost': instance.get_config('app_host'),
                'bookmarkletMode': !!state['bookmarkletMode'],
                'projectId': state['projectId'],
                'projectToken': state['token'],
                'userFlags': state['userFlags'],
                'userId': state['userId']
            };
            window.sessionStorage.setItem('editorParams', JSON.stringify(editorParams));

            if (state['desiredHash']) {
                window.location.hash = state['desiredHash'];
            } else if (window.history) {
                history.replaceState('', document.title, window.location.pathname + window.location.search); // completely remove hash
            } else {
                window.location.hash = ''; // clear hash (but leaves # unfortunately)
            }
        } catch (e) {
            console.error('Unable to parse data from hash', e);
        }
        return editorParams;
    },

    /**
     * To load the visual editor, we need an access token and other state. That state comes from one of three places:
     * 1. In the URL hash params if the customer is using an old snippet
     * 2. From session storage under the key `_mpcehash` if the snippet already parsed the hash
     * 3. From session storage under the key `editorParams` if the editor was initialized on a previous page
     */
    _maybeLoadEditor: function(instance) {
        var parseFromUrl = false;
        if (_.getHashParam(window.location.hash, 'state')) {
            var state = _.getHashParam(window.location.hash, 'state');
            state = JSON.parse(decodeURIComponent(state));
            parseFromUrl = state['action'] === 'mpeditor';
        }
        var parseFromStorage = !!window.sessionStorage.getItem('_mpcehash');
        var editorParams;

        if (parseFromUrl) { // happens if they are initializing the editor using an old snippet
            editorParams = this._editorParamsFromHash(instance, window.location.hash);
        } else if (parseFromStorage) { // happens if they are initialized the editor and using the new snippet
            editorParams = this._editorParamsFromHash(instance, window.sessionStorage.getItem('_mpcehash'));
            window.sessionStorage.removeItem('_mpcehash');
        } else { // get credentials from sessionStorage from a previous initialzation
            editorParams = JSON.parse(window.sessionStorage.getItem('editorParams') || '{}');
        }

        if (editorParams['projectToken'] && instance.get_config('token') === editorParams['projectToken']) {
            this._loadEditor(instance, editorParams);
            return true;
        } else {
            return false;
        }
    },

    // only load the codeless event editor once, even if there are multiple instances of MixpanelLib
    _editorLoaded: false,
    _loadEditor: function(instance, editorParams) {
        if (!this._editorLoaded) {
            this._editorLoaded = true;
            var editorUrl;
            var cacheBuster = '?_ts=' + (new Date()).getTime();
            if (Config.DEBUG) {
                editorUrl = instance.get_config('app_host') + '/site_media/compiled/reports/collect-everything/editor.js' + cacheBuster;
            } else {
                editorUrl = instance.get_config('app_host') + '/site_media/bundle-webpack/reports/collect-everything/editor.min.js' + cacheBuster;
            }
            this._loadScript(editorUrl, function() {
                window['mp_load_editor'](editorParams);
            });
            return true;
        }
        return false;
    },

    // this is a mechanism to ramp up CE with no server-side interaction.
    // when CE is active, every page load results in a decide request. we
    // need to gently ramp this up so we don't overload decide. this decides
    // deterministically if CE is enabled for this project by modding the char
    // value of the project token.
    enabledForProject: function(token, numBuckets, numEnabledBuckets) {
        numBuckets = !_.isUndefined(numBuckets) ? numBuckets : 10;
        numEnabledBuckets = !_.isUndefined(numEnabledBuckets) ? numEnabledBuckets : 10;
        var charCodeSum = 0;
        for (var i = 0; i < token.length; i++) {
            charCodeSum += token.charCodeAt(i);
        }
        return (charCodeSum % numBuckets) < numEnabledBuckets;
    },

    isBrowserSupported: function() {
        return _.isFunction(document.querySelectorAll);
    }
};

_.bind_instance_methods(ce);
_.safewrap_instance_methods(ce);

export { DISABLE_COOKIE, ce };
