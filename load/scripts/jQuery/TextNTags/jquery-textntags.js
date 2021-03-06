/*
 * Text'N'Tags (textntags)
 * Version 0.1.2
 * Written by: Daniel Zahariev
 *
 * Dependencies: jQuery, underscore.js
 *
 * License: MIT License - http://www.opensource.org/licenses/mit-license.php
 */
(function ($, _, undefined) {

    // Keys "enum"
    var KEY = { V: 86, Z: 90, BACKSPACE: 8, TAB: 9, RETURN: 13, ESC: 27, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, COMMA: 188, SPACE: 32, HOME: 36, END: 35, 'DELETE': 46 };
    var defaultSettings = {
        onDataRequest: $.noop,
        realValOnSubmit: true,
        triggers: { '@': {} },
        templates: {
            wrapper: _.template('<div class="textntags-wrapper"></div>'),
            beautifier: _.template('<div class="textntags-beautifier"><div></div></div>'),
            //Ramin's
            tagHighlight: _.template('<strong class="<%= class_name %>" ' + /* 'style="font-family:tahoma;"' + */'><span>$<%= idx %></span></strong>'),
            //tagHighlight: _.template('<strong class="<%= class_name %>"><span>$<%= idx %></span></strong>'),
            //end of Ramin's
            tagList: _.template('<div class="textntags-tag-list"></div>'),
            tagsListItem: _.template('<li><%= title %></li>'),
            tagsListItemImage: _.template('<img src="<%= img %>" />'),
            tagsListItemIcon: _.template('<div class="icon <%= no_img_class %>"></div>')
        }
    };

    var trigger_defaults = {
        minChars: 2,
        uniqueTags: true,
        showImageOrIcon: true,
        keys_map: { id: 'id', title: 'name', description: '', img: 'avatar', no_img_class: 'icon', type: 'type', info: 'info' },
        syntax: _.template('@[[<%= id %>:<%= type %>:<%= title %>:<%= info %>]]'),
        //Ramin's
        //parser: /(@)\[\[(\d+):([\w\s\.\-]+):([\w\s@\.,-\/#!$%\^&\*;:{}=\-_`~()]+)\]\]/gi,  //--> Original, Commented By Ramin
        //parser: /(@)\[\[([a-zA-Z\d\-]+):([\w\s\.\-]+):([\w\u0621-\u064A\u0660-\u0669\u0671-\u06D3\u06F0-\u06F9\s@\.,-\/#!$%\^&\*;:{}=\-_`~()]+)\]\]/gi,
        parser: /(@)\[\[([a-zA-Z\d\-_]+):([\w\s\.\-]+):([\w\u0621-\u064A\u0660-\u0669\u0671-\u06D3\u06F0-\u06F9\s\.,-\/#!$%\^&\*;{}=\-_`~()]+|[A-Za-z0-9+/=]+)(:([0-9a-zA-Z+/=]*))?\]\]/gi,
        //end of Ramin's
        parserGroups: { id: 2, type: 3, title: 4, info: 6 },
        classes: {
            tagsDropDown: '',
            tagActiveDropDown: 'active',
            tagHighlight: ''
        }
    };

    function transformObjectPropertiesFn(keys_map) {
        return function (obj, localToPublic) {
            var new_obj = {};
            if (localToPublic) {
                _.each(keys_map, function (v, k) { new_obj[v] = obj[k]; });
            } else {
                _.each(keys_map, function (v, k) { new_obj[k] = obj[v]; });
            }
            return new_obj;
        };
    }

    var transformObjectProperties = _.memoize(transformObjectPropertiesFn);

    var utils = {
        htmlEncode: function (str) {
            return _.escape(str);
        },
        highlightTerm: function (value, term) {
            if (!term && !term.length) {
                return value;
            }
            return value.replace(new RegExp("(?![^&;]+;)(?!<[^<>]*)(" + term + ")(?![^<>]*>)(?![^&;]+;)", "gi"), "<b>$1</b>");
        },
        setCaratPosition: function (domNode, caretPos) {
            if (domNode.createTextRange) {
                var range = domNode.createTextRange();
                range.move('character', caretPos);
                range.select();
            } else {
                if (domNode.selectionStart) {
                    domNode.focus();
                    domNode.setSelectionRange(caretPos, caretPos);
                } else {
                    domNode.focus();
                }
            }
        }
    };

    var TextNTags = function (editor) {
        var settings = null, templates;
        var elContainer, elEditor, elBeautifier, elTagList, elTagListItemActive;
        var tagsCollection;
        var currentTriggerChar, currentDataQuery;
        var editorSelectionLength = 0, editorTextLength = 0, editorKeyCode = 0, editorAddingTag = false;
        var editorInPasteMode = false, editorPasteStartPosition = 0, editorPasteCutCharacters = 0;

        function setSettings(options) {
            if (settings != null) {
                return false;
            }
            
            settings = $.extend(true, {}, defaultSettings, options);
            delete settings.triggers[''];
            _.each(settings.triggers, function (val, key) {
                settings.triggers[key] = $.extend(true, {}, trigger_defaults, val);
                //Ramin's
                //settings.triggers[key].finder = new RegExp(key + '\\w+(\\s+\\w+)?\\s?$', 'gi');  --> Original, Commented By Ramin
                var __letters = '[\\w\\u0621-\\u064A\\u0660-\\u0669\\u0671-\\u06D3\\u06F0-\\u06F9]+';
                settings.triggers[key].finder = new RegExp(key + __letters + '(\\s+' + __letters + ')?\\s?$', 'gi'); //'\\w+(\\s+\\w+)?\\s?$', 'gi');
                //end of Ramin's
            });

            templates = settings.templates;
            
            return true;
        }

        function initTextarea() {
            elEditor = $(editor).bind({
                click: onEditorClick,
                keydown: onEditorKeyDown,
                keypress: onEditorKeyPress,
                keyup: onEditorKeyUp,
                input: onEditorInput,
                blur: onEditorBlur
            });
            
            elContainer = elEditor.wrapAll($(templates.wrapper())).parent();

            if (settings.realValOnSubmit) {
                elEditor.closest('form').bind('submit.textntags', function (event) {
                    elContainer.css('visibility', 'hidden');
                    elEditor.val(getTaggedText());
                });
            }
        }

        function initTagList() {
            elTagList = $(templates.tagList());
            elTagList.appendTo(elContainer);
            elTagList.delegate('li', 'click', onTagListItemClick);
        }

        function initBeautifier() {
            elBeautifier = $(templates.beautifier());
            elBeautifier.prependTo(elContainer);
        }

        function initState() {
            var text_with_tags = getEditorValue(), initialState = parseTaggedText(text_with_tags);
            tagsCollection = initialState.tagsCollection;
            elEditor.val(initialState.plain_text);
            updateBeautifier();

            if (tagsCollection.length > 0) {
                var addedTags = _.uniq(_.map(tagsCollection, function (tagPos) { return tagPos[3]; }));
                elEditor.trigger('tagsAdded.textntags', [addedTags]);
            }
        }

        function getEditorValue() {
            return elEditor.val();
        }

        function getBeautifiedText(tagged_text) {
            //Ramin's
            var beautified_text = (tagged_text || getTaggedText()).replace(/</g, "&lt;");
            //commented by Ramin
            //var beautified_text = tagged_text || getTaggedText();
            //end of Ramin's

            _.each(settings.triggers, function (trigger) {
                var markup = templates.tagHighlight({ idx: trigger.parserGroups.title, class_name: trigger.classes.tagHighlight });
                beautified_text = beautified_text.replace(trigger.parser, markup);
            });

            //Ramin's
            if (beautified_text != "") {
                _.each(settings.triggers, function (tr) {
                    var _tt = tr.keys_map.title;
                    for (var i = 0, lnt = tagsCollection.length; i < lnt; ++i)
                        beautified_text = beautified_text.replace(Base64.encode(tagsCollection[i][3][_tt]), tagsCollection[i][3][_tt]);
                });
            }
            //end of Ramin's

            beautified_text = beautified_text.replace(/\n/g, '<br />&shy;');
            beautified_text = beautified_text.replace(/ {2}/g, ' &nbsp;') + '&shy;';

            return beautified_text;
        }

        function getTaggedText() {
            var plain_text = getEditorValue(),
                position = 0, tagged_text, triggers = settings.triggers;

            tagged_text = _.map(tagsCollection, function (tagPos) {
                //Ramin's
                /* 
                var diff_pos = tagPos[0] - position,
                diff_text = diff_pos > 0 ? plain_text.substr(position, diff_pos) : '',
                objPropTransformer = transformObjectProperties(triggers[tagPos[2]].keys_map),
                tagText = triggers[tagPos[2]].syntax(objPropTransformer(tagPos[3], false));
                */
                var diff_pos = tagPos[0] - position,
                    diff_text = diff_pos > 0 ? plain_text.substr(position, diff_pos) : '',
                    objPropTransformer = transformObjectProperties(triggers[tagPos[2]].keys_map);

                var _tg = objPropTransformer(tagPos[3], false);
                _tg.title = Base64.encode(_tg.title);
                var tagText = triggers[tagPos[2]].syntax(_tg);
                //end of Ramin's

                position = tagPos[0] + tagPos[1];
                return diff_text + tagText;
            });

            return tagged_text.join('') + plain_text.substr(position);
        }

        // it's ready for export
        function parseTaggedText(tagged_text) {
            //Ramin's
            setSettings();
            //end of Ramin's

            if (_.isString(tagged_text) == false) {
                return null;
            }
            var plain_text = '' + tagged_text, tagsColl = [], triggers = settings.triggers;

            //Ramin's
            var _rpDic = [];
            //end of Ramin's

            _.each(triggers, function (opts, tchar) {
                var parts = tagged_text.split(opts.parser),
                    idx = 0, pos = 0, len = parts.length,
                    found_tag, found_len, part_len,
                    max_group = _.max(opts.parserGroups);

                while (idx < len) {
                    if (parts[idx] == tchar) {
                        found_tag = {};
                        _.each(opts.parserGroups, function (v, k) {
                            found_tag[opts.keys_map[k]] = parts[idx + v - 1];
                            if (k == 'title') {
                                //Ramin's
                                /*
                                found_len = parts[idx + v - 1].length;
                                */
                                var _decoded = Base64.decode(found_tag[opts.keys_map[k]]);
                                if (found_tag[opts.keys_map[k]] != _decoded)
                                    _rpDic.push({ Main: found_tag[opts.keys_map[k]], Decoded: _decoded });
                                found_tag[opts.keys_map[k]] = _decoded;
                                found_len = found_tag[opts.keys_map[k]].length;
                                //end of Ramin's
                            }
                        });
                        
                        tagsColl.push([pos, found_len, tchar, found_tag]);
                        part_len = found_len;
                        idx += max_group;
                    } else {
                        part_len = parts[idx].length;
                        idx += 1;
                    }
                    pos += part_len;
                }
            });

            tagsColl = _.sortBy(tagsColl, function (tagPos) { return tagPos[0]; });

            _.each(triggers, function (opts, tchar) {
                plain_text = plain_text.replace(opts.parser, '$' + opts.parserGroups.title);
            });

            //Ramin's
            for (var i = 0, lnt = _rpDic.length; i < lnt; ++i)
                plain_text = plain_text.replace(_rpDic[i].Main, _rpDic[i].Decoded);
            //end of Ramin's

            return {
                plain_text: plain_text,
                tagged_text: tagged_text,
                tagsCollection: tagsColl
            };
        }

        function updateBeautifier() {
            elBeautifier.find('div').html(getBeautifiedText());
            elEditor.css('height', elBeautifier.outerHeight() + 'px');
        }

        function checkForTrigger(look_ahead) {
            look_ahead = look_ahead || 0;

            var selectionStartFix = $.browser.webkit ? 0 : -1,
                sStart = elEditor[0].selectionStart + selectionStartFix,
                left_text = elEditor.val().substr(0, sStart + look_ahead),
                found_trigger, found_trigger_char = null, query;

            if (!left_text || !left_text.length) {
                return;
            }

            found_trigger = _.find(settings.triggers, function (trigger, tchar) {
                var matches = left_text.match(trigger.finder);
                if (matches) {
                    found_trigger_char = tchar;
                    query = matches[0].substr(tchar.length);
                    return true;
                }
                return false;
            });

            if (!found_trigger_char || (found_trigger && (query.length < found_trigger.minChars))) {
                hideTagList();
            } else {
                currentDataQuery = query;
                currentTriggerChar = found_trigger_char;
                _.defer(_.bind(searchTags, this, currentDataQuery, found_trigger_char));
            }
        }

        function onEditorClick(e) {
            checkForTrigger(0);
        }

        function onEditorKeyDown(e) {
            //Ramin's
            elEditor.trigger('keydown.textntags', e);
            //end of Ramin's

            var keys = KEY, // store in local var for faster lookup
                sStart = elEditor[0].selectionStart,
                sEnd = elEditor[0].selectionEnd,
                plain_text = elEditor.val();

            editorSelectionLength = sEnd - sStart;
            editorTextLength = plain_text.length;
            editorKeyCode = e.keyCode;

            switch (e.keyCode) {
                case keys.UP:
                case keys.DOWN:
                    if (!elTagList.is(':visible')) {
                        return true;
                    }

                    var elCurrentTagListItem = null;
                    if (e.keyCode == keys.DOWN) {
                        if (elTagListItemActive && elTagListItemActive.length) {
                            elCurrentTagListItem = elTagListItemActive.next();
                        } else {
                            elCurrentTagListItem = elTagList.find('li').first();
                        }
                    } else {
                        if (elTagListItemActive && elTagListItemActive.length) {
                            elCurrentTagListItem = elTagListItemActive.prev();
                        } else {
                            elCurrentTagListItem = elTagList.find('li').last();
                        }
                    }

                    selectTagListItem(elCurrentTagListItem, settings.triggers[currentTriggerChar].classes.tagActiveDropDown);
                    return false;

                case keys.RETURN:
                case keys.TAB:
                    if (elTagListItemActive && elTagListItemActive.length) {
                        editorAddingTag = true;
                        elTagListItemActive.click();
                        return false;
                    }
                    return true;

                case keys.BACKSPACE:
                case keys['DELETE']:
                    //Ramin's
                    //if (e.keyCode == keys.BACKSPACE && sStart == sEnd && sStart > 0) sStart -= 1; //Commented by Ramin
                    if (sStart == sEnd && sStart > 0) sStart -= 1;
                    //end of Ramin's

                    if (sEnd > sStart) {
                        removeTagsInRange(sStart, sEnd);
                        shiftTagsPosition(sStart, sStart - sEnd);
                    }
                    return true;

                case keys.LEFT:
                case keys.RIGHT:
                case keys.HOME:
                case keys.END:
                    _.defer(function () { checkForTrigger.call(this, 0); });
                    break;
                case keys.V:
                    // checking for paste
                    if (e.ctrlKey) {
                        editorInPasteMode = true;
                        editorPasteStartPosition = sStart;
                        editorPasteCutCharacters = sEnd - sStart;
                        removeTagsInRange(sStart, sEnd);
                    }
                    break;
                case keys.Z:
                    if (e.ctrlKey) {
                        // forbid undo
                        return false;
                    }
                    break;
            }

            return true;
        }

        function onEditorKeyPress(e) {
            if (e.keyCode == KEY.RETURN) {
                updateBeautifier(elEditor.val());
            }
            if (editorAddingTag) {
                if (e.keyCode == KEY.RETURN || e.keyCode == KEY.TAB) {
                    e.preventDefault();
                }
                editorAddingTag = false;
            }
        }

        function onEditorKeyUp(e) {
            if (editorInPasteMode) {
                editorInPasteMode = false;

                if (editorSelectionLength > 0) {
                    return;
                }

                var sStart = elEditor[0].selectionStart,
                    sEnd = elEditor[0].selectionEnd;

                shiftTagsPosition(editorPasteStartPosition, sEnd - editorPasteStartPosition - editorPasteCutCharacters);
                updateBeautifier();
            }
        }

        function onEditorInput(e) {
            var selectionStartFix = $.browser.webkit ? 0 : -1;
            if (editorKeyCode != KEY.BACKSPACE && editorKeyCode != KEY['DELETE']) {
                if (editorSelectionLength > 0) {
                    // delete of selection occured
                    var sStart = elEditor[0].selectionStart + selectionStartFix,
                        selectionLength = editorSelectionLength,
                        sEnd = sStart + selectionLength,
                        tags_shift_positions = elEditor.val().length - editorTextLength;
                    removeTagsInRange(sStart, sEnd);
                    shiftTagsPosition(sEnd, tags_shift_positions);
                } else if (!editorInPasteMode) {
                    // char input - shift with 1
                    var sStart = elEditor[0].selectionStart + selectionStartFix,
                        sEnd = elEditor[0].selectionEnd + selectionStartFix,
                        selectionLength = sEnd - sStart;

                    if (editorKeyCode == KEY.RETURN) {
                        shiftTagsPosition(sStart - 1, 1);
                        removeTagsInRange(sStart, sStart);
                    } else {
                        shiftTagsPosition(sStart, 1);
                        removeTagsInRange(sStart, sStart + 1);
                    }
                }
            }

            updateBeautifier();

            checkForTrigger(1);
        }

        function onEditorBlur(e) {
            //Ramin's
            _.delay(hideTagList, 200);
            //_.delay(hideTagList, 100);
            //end of Ramin's
        }
        
        function hideTagList() {
            elTagListItemActive = null;
            elTagList.hide().empty();
        }

        function onTagListItemClick(e) {
            addTag($(this).data('tag'));
            return false;
        }

        function removeTagsInRange(start, end) {
            var removedTags = [];
            tagsCollection = _.filter(tagsCollection, function (tagPos) {
                var s = tagPos[0], e = s + tagPos[1],
                    inRange = ((s >= start && s < end) || (e > start && e <= end) || (s < start && e > end));
                if (inRange) {
                    removedTags.push(tagPos[3]);
                }
                return !inRange;
            });

            if (removedTags.length > 0) {
                elEditor.trigger('tagsRemoved.textntags', [removedTags]);
            }
        }

        function shiftTagsPosition(afterPosition, position_shift) {
            tagsCollection = _.map(tagsCollection, function (tagPos) {
                if (tagPos[0] >= afterPosition) {
                    tagPos[0] += position_shift;
                }
                return tagPos;
            });
        }

        function addTag(tag) {
            var trigger = settings.triggers[currentTriggerChar],
                objPropTransformer = transformObjectProperties(trigger.keys_map),
                localTag = objPropTransformer(tag, false), plain_text = getEditorValue(),
                sStart = elEditor[0].selectionStart,
                tagStart = sStart - currentTriggerChar.length - currentDataQuery.length,
                newCaretPosition = tagStart + localTag.title.length,
                left_text = plain_text.substr(0, tagStart),
                right_text = plain_text.substr(sStart),
                new_text = left_text + localTag.title + right_text;

            // shift the tags after the current new one
            shiftTagsPosition(sStart, newCaretPosition - sStart);

            // explicitly convert to string for comparisons later
            tag[trigger.keys_map.id] = '' + tag[trigger.keys_map.id];

            tagsCollection.push([tagStart, localTag.title.length, currentTriggerChar, tag]);
            tagsCollection = _.sortBy(tagsCollection, function (t) { return t[0]; });

            currentTriggerChar = '';
            currentDataQuery = '';
            hideTagList();

            elEditor.val(new_text);
            updateBeautifier();

            elEditor.focus();
            utils.setCaratPosition(elEditor[0], newCaretPosition);

            elEditor.trigger('tagsAdded.textntags', [[tag]]);
        }

        function selectTagListItem(tagItem, class_name) {
            if (tagItem && tagItem.length) {
                tagItem.addClass(class_name);
                tagItem.siblings().removeClass(class_name);
                elTagListItemActive = tagItem;
            } else {
                elTagListItemActive.removeClass(class_name);
                elTagListItemActive = null;
            }
        }

        function populateTagList(query, triggerChar, results) {
            var trigger = settings.triggers[triggerChar];

            //Ramin's
            elTagList.empty();
            //end of Ramin's

            if (trigger.uniqueTags) {
                // Filter items that has already been mentioned
                var id_key = trigger.keys_map.id, tagIds = _.map(tagsCollection, function (tagPos) { return tagPos[3][id_key]; });
                results = _.reject(results, function (item) {
                    // converting to string ids
                    return _.include(tagIds, '' + item[id_key]);
                });
            }

            //Ramin's
            //if (!results.length) return; //Commented by Ramin
            //Ramin's

            var tagsDropDown = $("<ul />").addClass(trigger.classes.tagsDropDown).appendTo(elTagList),
                imgOrIconTpl = trigger.showImageOrIcon ? templates.tagsListItemImage : templates.tagsListItemIcon,
                objPropTransformer = transformObjectProperties(trigger.keys_map);
            
            //Ramin's
            var load_file = function (isNode) {
                var fileName = isNode ? "NodeSelect" : "UserSelect";
                var fileAddress = (isNode ? "Ontology/" : "USR/") + fileName + ".js";
                var containerName = "__" + fileName + "Container";
                var showedWindowName = "__Showed" + fileName;

                if (editor[containerName]) {
                    editor[showedWindowName] = GlobalUtilities.show(editor[containerName]);
                    return;
                }
                
                var _div = editor[containerName] = GlobalUtilities.create_nested_elements([
                    {
                        Type: "div", Class: "small-10 medium-8 larg-6 rv-border-radius-1 SoftBackgroundColor",
                        Style: "margin:0rem auto; padding:1rem;", Name: "_div"
                    }
                ])["_div"];

                editor[showedWindowName] = GlobalUtilities.show(_div);
                GlobalUtilities.loading(_div);

                GlobalUtilities.load_files([fileAddress], {
                    OnLoad: function () {
                        new window[fileName](_div, {
                            Options: {
                                Title: RVDic.NodeSelect,
                                NodeTypeSearchBox: true, TreeCheckbox: false, HideSelectedItems: true, Filters: true,
                                OnSelect: function (item) {
                                    editor[showedWindowName].Close();

                                    addTag(isNode ? { id: item.NodeID, avatar: "", type: "Node", name: item.Name } : {
                                        id: item.UserID, avatar: item.ImageURL, type: "User",
                                        name: Base64.decode(item.FirstName) + " " + Base64.decode(item.LastName)
                                    });
                                }
                            }
                        });
                    }
                });
            }
            
            GlobalUtilities.create_nested_elements([
                {
                    Type: "div", Style: "width:260px; margin:0px auto 0px auto;" +
                        "font-size:x-small; font-weight:bold;",
                    Childs: [
                        {
                            Type: "div", Style: "margin:8px; width:100px; text-align:center;" +
                                "color:gray; cursor:pointer;",
                            Class: "Float SoftBorder SoftBackgroundColor NormalPadding BorderRadius4",
                            Properties: [
                                { Name: "onmouseover", Value: function () { this.style.color = "black"; } },
                                { Name: "onmouseout", Value: function () { this.style.color = "gray"; } },
                                { Name: "onclick", Value: function () { load_file(false); } }
                            ],
                            Childs: [
                                {
                                    Type: "img", Style: "margin-" + window.RV_RevFloat + ":4px;",
                                    Attributes: [{ Name: "src", Value: GlobalUtilities.icon("User12.png") }]
                                },
                                { Type: "text", TextValue: RVDic.UserSelect }
                            ]
                        },
                        {
                            Type: "div", Style: "margin:8px; width:100px; text-align:center;" +
                                "color:gray; cursor:pointer;",
                            Class: "RevFloat SoftBorder SoftBackgroundColor NormalPadding BorderRadius4",
                            Properties: [
                                { Name: "onmouseover", Value: function () { this.style.color = "black"; } },
                                { Name: "onmouseout", Value: function () { this.style.color = "gray"; } },
                                { Name: "onclick", Value: function () { load_file(true); } }
                            ],
                            Childs: [
                                {
                                    Type: "img", Style: "margin-" + window.RV_RevFloat + ":4px;",
                                    Attributes: [{Name: "src", Value: GlobalUtilities.icon("Graph12.png")}]
                                },
                                { Type: "text", TextValue: RVDic.NodeSelect }
                            ]
                        },
                        { Type: "div", Style: "clear:both;" }
                    ]
                }
            ], $(tagsDropDown).get(0));
            //end of Ramin's
            
            _.each(results, function (tag, index) {
                var tagItem, localTag = objPropTransformer(tag, false);
                localTag.title = utils.highlightTerm(utils.htmlEncode((localTag.title)), query);
                tagItem = $(templates.tagsListItem(localTag)).data('tag', tag);
                tagItem = tagItem.prepend(imgOrIconTpl(localTag)).appendTo(tagsDropDown);

                if (index === 0) {
                    selectTagListItem(tagItem, trigger.classes.tagActiveDropDown);
                }
            });

            elTagList.show();
        }

        function searchTags(query, triggerChar) {
            //Ramin's
            query = GlobalUtilities.verify_string(query);
            //end of Ramin's

            hideTagList();
            settings.onDataRequest.call(this, 'search', query, triggerChar, function (responseData) {
                populateTagList(query, triggerChar, responseData);
            });
        }

        // Public methods
        return {
            init: function (options) {
                if (setSettings(options)) {
                    initTextarea();
                    initTagList();
                    initBeautifier();
                    initState();
                }
            },
            val: function (callback) {
                //Ramin's
                if (!elEditor) return;
                //end of Ramin's
                if (_.isString(callback)) {
                    var removedTags = _.uniq(_.map(tagsCollection, function (tagPos) { return tagPos[3]; }));
                    elEditor.trigger('tagsRemoved.textntags', [removedTags]);
                    elEditor.val(callback);
                    initState();
                    return;
                } else if (!_.isFunction(callback)) {
                    return;
                }

                var value = tagsCollection.length ? getTaggedText() : getEditorValue();
                callback.call(this, value);
            },
            reset: function () {
                var removedTags = _.uniq(_.map(tagsCollection, function (tagPos) { return tagPos[3]; }));
                elEditor.trigger('tagsRemoved.textntags', [removedTags]);
                elEditor.val('');
                tagsCollection = [];
                updateBeautifier();
            },
            getTags: function (callback) {
                if (!_.isFunction(callback)) {
                    return;
                }
                var tags = _.map(tagsCollection, function (tagPos) { return tagPos[3]; });

                callback.call(this, _.uniq(tags));
            },
            getTagsMap: function (callback) {
                if (!_.isFunction(callback)) {
                    return;
                }

                callback.call(this, tagsCollection);
            },
            getTagsMapFacebook: function (callback) {
                if (!_.isFunction(callback)) {
                    return;
                }
                var fbTagsCollection = {}, triggers = settings.triggers;

                _.each(tagsCollection, function (tagPos) {
                    var objPropTransformer = transformObjectProperties(triggers[tagPos[2]].keys_map),
                        localTag = objPropTransformer(tagPos[3], false);
                    fbTagsCollection[tagPos[0]] = [{
                        id: localTag.id,
                        name: localTag.title,
                        type: localTag.type,
                        offset: tagPos[0],
                        length: tagPos[1]
                    }];
                });

                callback.call(this, fbTagsCollection);
            },
            parseTaggedText: function (tagged_text, callback) {
                if (!_.isFunction(callback)) {
                    return;
                }

                callback.call(this, parseTaggedText(tagged_text));
            }
        };
    };

    $.fn.textntags = function (methodOrSettings) {
        var outerArguments = arguments;
        
        return this.each(function () {
            var ms = methodOrSettings, instance = $.data(this, 'textntags') || $.data(this, 'textntags', new TextNTags(this));

            if (_.isFunction(instance[ms])) {
                return instance[ms].apply(this, Array.prototype.slice.call(outerArguments, 1));
            } else if (typeof ms === 'object' || !ms) {
                return instance.init.call(this, ms);
            } else {
                $.error('Method ' + ms + ' does not exist');
            }
        });
    };

})(jQuery, _);