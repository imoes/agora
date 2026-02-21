using System;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace AgoraWindows.Helpers;

/// <summary>
/// Attached property for RichTextBox that converts HTML content to a FlowDocument.
/// Supports common Quill editor output: h1-h3, p, strong/b, em/i, u, s, blockquote, pre, code, ul, ol, li, a, br.
/// </summary>
public static class RichTextBoxHelper
{
    public static readonly DependencyProperty HtmlProperty =
        DependencyProperty.RegisterAttached("Html", typeof(string), typeof(RichTextBoxHelper),
            new PropertyMetadata(null, OnHtmlChanged));

    public static void SetHtml(DependencyObject obj, string value) => obj.SetValue(HtmlProperty, value);
    public static string GetHtml(DependencyObject obj) => (string)obj.GetValue(HtmlProperty);

    private static void OnHtmlChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is RichTextBox rtb)
        {
            var html = e.NewValue as string ?? "";
            rtb.Document = ConvertHtmlToFlowDocument(html);
        }
    }

    public static FlowDocument ConvertHtmlToFlowDocument(string html)
    {
        var doc = new FlowDocument
        {
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 13,
            PagePadding = new Thickness(0)
        };

        if (string.IsNullOrEmpty(html))
            return doc;

        // Decode HTML entities (use placeholders for < > to avoid confusion with tags)
        html = html.Replace("&nbsp;", " ")
                   .Replace("&amp;", "&")
                   .Replace("&lt;", "\x01")
                   .Replace("&gt;", "\x02")
                   .Replace("&quot;", "\"")
                   .Replace("&apos;", "'");

        // If no HTML tags, treat as plain text
        if (!Regex.IsMatch(html, @"<\w"))
        {
            var plainText = html.Replace("\x01", "<").Replace("\x02", ">");
            doc.Blocks.Add(new Paragraph(new Run(plainText)));
            return doc;
        }

        int pos = 0;
        while (pos < html.Length)
        {
            while (pos < html.Length && char.IsWhiteSpace(html[pos])) pos++;
            if (pos >= html.Length) break;

            if (html[pos] == '<')
            {
                var tagMatch = Regex.Match(html.Substring(pos), @"^<(\/?)?(\w+)(\s[^>]*)?>", RegexOptions.IgnoreCase);
                if (!tagMatch.Success) { pos++; continue; }

                var isClose = tagMatch.Groups[1].Value == "/";
                var tag = tagMatch.Groups[2].Value.ToLower();
                var afterOpen = pos + tagMatch.Length;

                if (isClose) { pos = afterOpen; continue; }

                switch (tag)
                {
                    case "h1":
                    case "h2":
                    case "h3":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var para = new Paragraph
                        {
                            FontWeight = FontWeights.Bold,
                            Margin = new Thickness(0, 0, 0, 4),
                            FontSize = tag == "h1" ? 22 : tag == "h2" ? 18 : 15
                        };
                        ParseInlines(para.Inlines, content);
                        doc.Blocks.Add(para);
                        pos = end;
                        break;
                    }
                    case "p":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var para = new Paragraph { Margin = new Thickness(0, 0, 0, 4) };
                        ParseInlines(para.Inlines, content);
                        doc.Blocks.Add(para);
                        pos = end;
                        break;
                    }
                    case "blockquote":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var para = new Paragraph
                        {
                            Margin = new Thickness(0, 0, 0, 4),
                            Padding = new Thickness(10, 4, 4, 4),
                            BorderBrush = new SolidColorBrush(Color.FromRgb(0x99, 0x99, 0x99)),
                            BorderThickness = new Thickness(3, 0, 0, 0),
                            Foreground = new SolidColorBrush(Color.FromRgb(0x66, 0x66, 0x66))
                        };
                        // Recursively parse inner HTML (blockquotes may contain <p> tags)
                        var innerHtml = content.Trim();
                        if (innerHtml.StartsWith("<p>", StringComparison.OrdinalIgnoreCase))
                        {
                            ParseInlines(para.Inlines, StripOuterTag(innerHtml, "p"));
                        }
                        else
                        {
                            ParseInlines(para.Inlines, content);
                        }
                        doc.Blocks.Add(para);
                        pos = end;
                        break;
                    }
                    case "pre":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var cleaned = StripTags(content);
                        var para = new Paragraph
                        {
                            FontFamily = new FontFamily("Consolas"),
                            Background = new SolidColorBrush(Color.FromRgb(0xF5, 0xF5, 0xF5)),
                            Padding = new Thickness(8),
                            Margin = new Thickness(0, 0, 0, 4)
                        };
                        para.Inlines.Add(new Run(cleaned));
                        doc.Blocks.Add(para);
                        pos = end;
                        break;
                    }
                    case "ul":
                    case "ol":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var list = new List
                        {
                            MarkerStyle = tag == "ul" ? TextMarkerStyle.Disc : TextMarkerStyle.Decimal,
                            Margin = new Thickness(0, 0, 0, 4)
                        };

                        var liMatches = Regex.Matches(content, @"<li(\s[^>]*)?>(.+?)</li>",
                            RegexOptions.IgnoreCase | RegexOptions.Singleline);
                        foreach (Match liMatch in liMatches)
                        {
                            var para = new Paragraph { Margin = new Thickness(0) };
                            ParseInlines(para.Inlines, liMatch.Groups[2].Value);
                            list.ListItems.Add(new ListItem(para));
                        }
                        doc.Blocks.Add(list);
                        pos = end;
                        break;
                    }
                    case "br":
                    {
                        doc.Blocks.Add(new Paragraph { Margin = new Thickness(0), FontSize = 4 });
                        pos = afterOpen;
                        break;
                    }
                    case "div":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterOpen);
                        var para = new Paragraph { Margin = new Thickness(0, 0, 0, 2) };
                        ParseInlines(para.Inlines, content);
                        doc.Blocks.Add(para);
                        pos = end;
                        break;
                    }
                    default:
                    {
                        // Unknown block tag - skip opening tag
                        pos = afterOpen;
                        break;
                    }
                }
            }
            else
            {
                var nextTag = html.IndexOf('<', pos);
                if (nextTag < 0) nextTag = html.Length;
                var text = Decode(html.Substring(pos, nextTag - pos));
                if (!string.IsNullOrWhiteSpace(text))
                {
                    doc.Blocks.Add(new Paragraph(new Run(text)));
                }
                pos = nextTag;
            }
        }

        if (doc.Blocks.Count == 0)
        {
            doc.Blocks.Add(new Paragraph(new Run(Decode(html))));
        }

        return doc;
    }

    private static (string content, int endPos) ExtractBlock(string html, string tag, int startAfterOpen)
    {
        var closeTag = $"</{tag}>";
        var endIdx = html.IndexOf(closeTag, startAfterOpen, StringComparison.OrdinalIgnoreCase);
        if (endIdx < 0) return (html.Substring(startAfterOpen), html.Length);
        return (html.Substring(startAfterOpen, endIdx - startAfterOpen), endIdx + closeTag.Length);
    }

    private static void ParseInlines(InlineCollection inlines, string html)
    {
        if (string.IsNullOrEmpty(html)) return;

        int pos = 0;
        while (pos < html.Length)
        {
            if (html[pos] == '<')
            {
                var tagMatch = Regex.Match(html.Substring(pos), @"^<(\/?)?(\w+)(\s[^>]*)?>", RegexOptions.IgnoreCase);
                if (!tagMatch.Success) { pos++; continue; }

                var isClose = tagMatch.Groups[1].Value == "/";
                var tag = tagMatch.Groups[2].Value.ToLower();
                var attrs = tagMatch.Groups[3].Value;
                var afterTag = pos + tagMatch.Length;

                if (isClose) { pos = afterTag; continue; }

                switch (tag)
                {
                    case "strong":
                    case "b":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        var bold = new Bold();
                        ParseInlines(bold.Inlines, content);
                        inlines.Add(bold);
                        pos = end;
                        break;
                    }
                    case "em":
                    case "i":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        var italic = new Italic();
                        ParseInlines(italic.Inlines, content);
                        inlines.Add(italic);
                        pos = end;
                        break;
                    }
                    case "u":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        var underline = new Underline();
                        ParseInlines(underline.Inlines, content);
                        inlines.Add(underline);
                        pos = end;
                        break;
                    }
                    case "s":
                    case "strike":
                    case "del":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        var span = new Span { TextDecorations = TextDecorations.Strikethrough };
                        ParseInlines(span.Inlines, content);
                        inlines.Add(span);
                        pos = end;
                        break;
                    }
                    case "code":
                    {
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        inlines.Add(new Run(StripTags(content))
                        {
                            FontFamily = new FontFamily("Consolas"),
                            Background = new SolidColorBrush(Color.FromRgb(0xE8, 0xE8, 0xE8)),
                        });
                        pos = end;
                        break;
                    }
                    case "a":
                    {
                        var hrefMatch = Regex.Match(attrs, @"href\s*=\s*""([^""]+)""", RegexOptions.IgnoreCase);
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        var linkText = StripTags(content);
                        try
                        {
                            var hyperlink = new Hyperlink(new Run(Decode(linkText)))
                            {
                                Foreground = new SolidColorBrush(Color.FromRgb(0x62, 0x64, 0xA7))
                            };
                            if (hrefMatch.Success)
                            {
                                var href = Decode(hrefMatch.Groups[1].Value);
                                hyperlink.NavigateUri = new Uri(href, UriKind.RelativeOrAbsolute);
                            }
                            hyperlink.RequestNavigate += (_, e) =>
                            {
                                System.Diagnostics.Process.Start(
                                    new System.Diagnostics.ProcessStartInfo(e.Uri.AbsoluteUri) { UseShellExecute = true });
                                e.Handled = true;
                            };
                            inlines.Add(hyperlink);
                        }
                        catch
                        {
                            inlines.Add(new Run(Decode(linkText)));
                        }
                        pos = end;
                        break;
                    }
                    case "br":
                    {
                        inlines.Add(new LineBreak());
                        pos = afterTag;
                        break;
                    }
                    case "p":
                    {
                        // Nested <p> inside inline context - treat as line break + content
                        var (content, end) = ExtractBlock(html, tag, afterTag);
                        if (inlines.Count > 0) inlines.Add(new LineBreak());
                        ParseInlines(inlines, content);
                        pos = end;
                        break;
                    }
                    default:
                    {
                        pos = afterTag;
                        break;
                    }
                }
            }
            else
            {
                var nextTag = html.IndexOf('<', pos);
                if (nextTag < 0) nextTag = html.Length;
                var text = Decode(html.Substring(pos, nextTag - pos));
                if (text.Length > 0)
                    inlines.Add(new Run(text));
                pos = nextTag;
            }
        }
    }

    private static string StripTags(string html)
    {
        return Decode(Regex.Replace(html, @"<[^>]+>", ""));
    }

    private static string Decode(string text)
    {
        return text.Replace("\x01", "<").Replace("\x02", ">");
    }

    private static string StripOuterTag(string html, string tag)
    {
        var pattern = $@"^<{tag}(\s[^>]*)?>(.+?)</{tag}>$";
        var match = Regex.Match(html.Trim(), pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return match.Success ? match.Groups[2].Value : html;
    }
}
